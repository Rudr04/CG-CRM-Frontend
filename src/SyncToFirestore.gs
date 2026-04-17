// ============================================================================
//  SyncToFirestore.gs — Real-time Sheet → Firestore sync
//  Installable onEdit trigger sends cell changes to Cloud Function
//
//  SETUP: Run setupSyncTrigger() once, or menu: CRM Add-Ons > Firebase > ⚡ Setup Realtime Sync
//
//  ERROR HANDLING:
//  - Failed syncs stored in Script Properties as dead letter queue
//  - Time-based trigger retries failed syncs every minute
//  - Max 3 retries per edit, then logged and discarded
//
//  All config pulled from CRM.SYNC / CRM.FIELD_HEADERS / CRM.PROPS — nothing local.
// ============================================================================


// ── Dead Letter Queue Config ────────────────────────────────────
var SYNC_CONFIG = {
  QUEUE_KEY:      'SYNC_DEAD_LETTER',
  MAX_QUEUE_SIZE: 200,
  MAX_RETRIES:    3,
  RETRY_DELAY_MS: 5000,
};


// ─────────────────────────────────────────────────────────────
//  MAIN TRIGGER FUNCTION (installable onEdit)
// ─────────────────────────────────────────────────────────────
function onSheetEditSync(e) {
  try {
    if (!e || !e.range) return;

    var sheet = e.range.getSheet();
    if (sheet.getName() !== CRM.SHEETS.DSR) return;

    // ─── KEY CHANGE: Detect if this is MY edit ───────────────────
    var triggerOwner = Session.getEffectiveUser().getEmail();  // Who edited (NULL if not my trigger)
    var activeUser = '';
    
    try {
      activeUser = Session.getActiveUser().getEmail();  // Who made the edit (if detectable)
    } catch (err) {}
    
    // If we can detect editor AND it's NOT the trigger owner → skip
    // That user's OWN trigger will handle it with their email
    if (triggerOwner && activeUser !== triggerOwner) {
      console.log('[Sync] Edit by ' + triggerOwner + ' — skipping (their own trigger will handle)');
      return;
    }
    
    // If we're here:
    // - activeUser === triggerOwner → I made the edit, use my email ✓
    // - activeUser is empty → Can't detect, use fallback
    // ─────────────────────────────────────────────────────────────

    var startRow = e.range.getRow();
    var startCol = e.range.getColumn();
    var numRows  = e.range.getNumRows();
    var numCols  = e.range.getNumColumns();

    if (startRow <= CRM.HEADER_ROW) return;

    var edits = [];

    // Batch-read entire affected area in ONE I/O call
    var lastCol = sheet.getLastColumn();
    var affectedData = sheet.getRange(startRow, 1, numRows, lastCol).getDisplayValues();

    // Read header row ONCE for this edit event
    var headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    // Find phone column index ONCE (0-based)
    var phoneColIdx = -1;
    for (var h = 0; h < headerRow.length; h++) {
      if ((headerRow[h] || '').toString().trim() === CRM.FIELD_HEADERS.number) {
        phoneColIdx = h;
        break;
      }
    }
    if (phoneColIdx === -1) {
      console.error('[Sync] "' + CRM.FIELD_HEADERS.number + '" header not found — aborting');
      return;
    }

    for (var r = 0; r < numRows; r++) {
      var row = startRow + r;
      var rowData = affectedData[r];

      for (var c = 0; c < numCols; c++) {
        var col = startCol + c;  // 1-based column number

        // Dynamic: look up header text for this column, then check if tracked
        var headerText = (headerRow[col - 1] || '').toString().trim();  // col is 1-based, headerRow is 0-based
        var fieldName = CRM.SYNC.TRACKED_HEADERS[headerText];
        if (!fieldName) continue;

        var phone = (rowData[phoneColIdx] || '').toString().trim();
        if (!phone) continue;

        // col is 1-based, rowData is 0-based — subtract 1
        var newValue = rowData[col - 1] || '';
        var oldValue = (numRows === 1 && numCols === 1 && e.oldValue !== undefined)
          ? e.oldValue : '';

        if (newValue === oldValue) continue;

        // Build rowData object with field keys for the CF
        var rowDataObj = {};
        for (var hi = 0; hi < headerRow.length; hi++) {
          var hText = (headerRow[hi] || '').toString().trim();
          var fKey = CRM.HEADER_TO_FIELD[hText];
          if (fKey) rowDataObj[fKey] = (rowData[hi] || '').toString();
        }

        // Stage edits get sent as a dedicated event, not a field sync
        if (fieldName === 'pipelineStage') {
          _sendStageTransition({
            phone:     phone,
            oldStage:  oldValue,
            newStage:  newValue,
            sourceRow: row,
            editor:    activeUser || triggerOwner,
          });
          continue;  // don't add to edits array
        }

        edits.push({
          row:        row,
          phone:      phone,
          field:      fieldName,
          oldValue:   oldValue,
          newValue:   newValue,
          action:     CRM.SYNC.HISTORY_ACTIONS[fieldName] || 'field_updated',
          timestamp:  new Date().getTime(),
          retryCount: 0,
          rowData:    rowDataObj,
        });
      }
    }

    if (edits.length === 0) return;

    // ─── Determine editor with fallback to Agent_Config ───────────
    var editor = activeUser || triggerOwner;
    
    console.info('[Sync] Processing edit by: ' + editor + ' (trigger owner: ' + triggerOwner + ')');
    _sendEditsToCloudFunction(edits, editor);

  } catch (error) {
    console.error('[Sync] Error (non-blocking): ' + error.toString());
  }
}


/**
 * Fallback: Look up editor email from Team column via Agent_Config
 */
function _getEditorFromTeamColumn(sheet, row) {
  try {
    var M = getColumnMap(sheet);
    if (M.team === undefined) return null;
    var teamValue = sheet.getRange(row, M.team + 1).getValue();

    if (!teamValue || teamValue === CRM.DEFAULTS.TEAM || teamValue === CRM.DEFAULTS.ROBO_AGENT) {
      return null;
    }

    var agent = getAgentByName(teamValue);
    return agent ? agent.email : null;

  } catch (err) {
    console.error('[Sync] _getEditorFromTeamColumn error: ' + err);
    return null;
  }
}


// ─────────────────────────────────────────────────────────────
//  SEND EDITS TO CLOUD FUNCTION
//  On failure, stores edits in dead letter queue
// ─────────────────────────────────────────────────────────────
function _sendEditsToCloudFunction(edits, editor) {
  var cfUrl = CRM.PROPS.CLOUD_FUNCTION_URL;
  if (!cfUrl) {
    console.warn('[Sync] CLOUD_FUNCTION_URL not set — storing in dead letter queue');
    _addToDeadLetterQueue(edits, 'NO_URL');
    return;
  }

  var payload = {
    eventType: 'sheet_edit',
    edits:     edits,
    editor:    editor,
    timestamp: new Date().getTime(),
  };

  try {
    var resp = UrlFetchApp.fetch(cfUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    var code = resp.getResponseCode();
    var body = {};
    
    try {
      body = JSON.parse(resp.getContentText());
    } catch (parseErr) {
      body = { error: resp.getContentText() };
    }

    if (code === 200) {
      // Check for partial failures reported by CF
      if (body.failed && body.failed.length > 0) {
        console.warn('[Sync] Partial failure: ' + body.failed.length + ' edit(s) failed');
        _addToDeadLetterQueue(body.failed, 'CF_PARTIAL_FAILURE');
      }
      
      console.log('[Sync] Batch sent: ' + edits.length + ' edit(s) — ' +
                  (body.synced || 0) + ' synced, ' + (body.errors || 0) + ' errors');
    } else if (code >= 500) {
      // Server error — retry later
      console.error('[Sync] CF server error ' + code + ' — queuing for retry');
      _addToDeadLetterQueue(edits, 'HTTP_' + code);
    } else if (code >= 400) {
      // Client error — log but don't retry (bad request)
      console.error('[Sync] CF client error ' + code + ': ' + resp.getContentText());
      // Still queue for manual review
      _addToDeadLetterQueue(edits, 'HTTP_' + code);
    }

  } catch (err) {
    // Network error — retry later
    console.error('[Sync] Network error: ' + err.toString());
    _addToDeadLetterQueue(edits, 'NETWORK_ERROR');
  }
}


/**
 * Send a stage transition event to Cloud Function.
 * Separate from field syncs — has its own handler and validation.
 */
function _sendStageTransition(transitionData) {
  var cfUrl = CRM.PROPS.CLOUD_FUNCTION_URL;
  if (!cfUrl) {
    console.warn('[Sync] CLOUD_FUNCTION_URL not set — stage transition not sent');
    return;
  }

  var payload = {
    eventType: 'stage_transition',
    phone:     transitionData.phone,
    oldStage:  transitionData.oldStage,
    newStage:  transitionData.newStage,
    sourceRow: transitionData.sourceRow,
    editor:    transitionData.editor,
    timestamp: new Date().getTime(),
  };

  try {
    var resp = UrlFetchApp.fetch(cfUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    var code = resp.getResponseCode();
    var body = {};
    try { body = JSON.parse(resp.getContentText()); } catch (e) { body = {}; }

    if (code === 200 && body.success !== false) {
      console.log('[Sync] Stage transition sent: ' + transitionData.phone +
        ' (' + transitionData.oldStage + ' → ' + transitionData.newStage + ')');
    } else {
      console.error('[Sync] Stage transition failed: HTTP ' + code +
        ' — ' + JSON.stringify(body));
      // Add to dead letter queue for manual review
      _addToDeadLetterQueue([{
        row:        transitionData.sourceRow,
        phone:      transitionData.phone,
        field:      'pipelineStage',
        oldValue:   transitionData.oldStage,
        newValue:   transitionData.newStage,
        retryCount: 0,
        failReason: 'stage_transition_failed_http_' + code,
      }], 'Stage transition HTTP error');
    }
  } catch (e) {
    console.error('[Sync] Stage transition fetch error: ' + e.message);
    _addToDeadLetterQueue([{
      row:        transitionData.sourceRow,
      phone:      transitionData.phone,
      field:      'pipelineStage',
      oldValue:   transitionData.oldStage,
      newValue:   transitionData.newStage,
      retryCount: 0,
      failReason: e.message,
    }], 'Stage transition network error');
  }
}


// ─────────────────────────────────────────────────────────────
//  DEAD LETTER QUEUE — Store failed syncs for retry
// ─────────────────────────────────────────────────────────────
function _addToDeadLetterQueue(edits, reason) {
  try {
    var sp = PropertiesService.getScriptProperties();
    var queue = JSON.parse(sp.getProperty(SYNC_CONFIG.QUEUE_KEY) || '[]');
    
    // Add failure metadata
    var now = new Date().getTime();
    edits.forEach(function(edit) {
      edit.failedAt = now;
      edit.failReason = reason;
      edit.retryCount = (edit.retryCount || 0) + 1;
    });
    
    // Append to queue, trim if too large
    queue = queue.concat(edits);
    if (queue.length > SYNC_CONFIG.MAX_QUEUE_SIZE) {
      // Remove oldest entries that have exceeded max retries
      queue = queue.filter(function(e) { return e.retryCount <= SYNC_CONFIG.MAX_RETRIES; });
      // If still too large, trim from front
      if (queue.length > SYNC_CONFIG.MAX_QUEUE_SIZE) {
        var discarded = queue.splice(0, queue.length - SYNC_CONFIG.MAX_QUEUE_SIZE);
        console.warn('[Sync] Discarded ' + discarded.length + ' old failed syncs');
      }
    }
    
    sp.setProperty(SYNC_CONFIG.QUEUE_KEY, JSON.stringify(queue));
    console.log('[Sync] Added ' + edits.length + ' edit(s) to dead letter queue. Reason: ' + reason);
    
  } catch (err) {
    console.error('[Sync] Failed to store in dead letter queue: ' + err.toString());
  }
}


// ─────────────────────────────────────────────────────────────
//  RETRY FAILED SYNCS — Called by time-based trigger
// ─────────────────────────────────────────────────────────────
function processPendingSyncs() {
  var sp = PropertiesService.getScriptProperties();
  var queue = JSON.parse(sp.getProperty(SYNC_CONFIG.QUEUE_KEY) || '[]');
  
  if (queue.length === 0) return;
  
  console.log('[Sync] Processing ' + queue.length + ' pending sync(s)...');
  
  // Separate into retryable and expired
  var retryable = [];
  var expired = [];
  
  queue.forEach(function(edit) {
    if (edit.retryCount >= SYNC_CONFIG.MAX_RETRIES) {
      expired.push(edit);
    } else {
      retryable.push(edit);
    }
  });
  
  // Log expired edits (these won't be retried)
  if (expired.length > 0) {
    console.error('[Sync] ' + expired.length + ' edit(s) exceeded max retries and will be discarded:');
    expired.forEach(function(e) {
      console.error('  - Row ' + e.row + ', ' + e.field + ' = "' + e.newValue + '" (reason: ' + e.failReason + ')');
    });
  }
  
  if (retryable.length === 0) {
    sp.setProperty(SYNC_CONFIG.QUEUE_KEY, '[]');
    return;
  }
  
  // Group by editor (use 'retry_job' as editor for retries)
  var editor = 'retry_job';
  
  // Attempt to send
  var cfUrl = CRM.PROPS.CLOUD_FUNCTION_URL;
  if (!cfUrl) {
    console.warn('[Sync] CLOUD_FUNCTION_URL still not set — keeping in queue');
    return;
  }
  
  var payload = {
    eventType: 'sheet_edit',
    edits:     retryable,
    editor:    editor,
    timestamp: new Date().getTime(),
    isRetry:   true,
  };
  
  try {
    var resp = UrlFetchApp.fetch(cfUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    
    var code = resp.getResponseCode();
    var body = {};
    
    try {
      body = JSON.parse(resp.getContentText());
    } catch (parseErr) {
      body = { error: resp.getContentText() };
    }
    
    if (code === 200) {
      // Success — check for partial failures
      if (body.failed && body.failed.length > 0) {
        // Keep only the failed ones in queue
        sp.setProperty(SYNC_CONFIG.QUEUE_KEY, JSON.stringify(body.failed));
        console.log('[Sync] Retry partial success: ' + (body.synced || 0) + ' synced, ' + 
                    body.failed.length + ' still pending');
      } else {
        // All succeeded — clear queue
        sp.setProperty(SYNC_CONFIG.QUEUE_KEY, '[]');
        console.log('[Sync] Retry success: ' + retryable.length + ' edit(s) synced');
      }
    } else {
      // Still failing — increment retry counts and keep in queue
      retryable.forEach(function(e) { e.retryCount++; });
      sp.setProperty(SYNC_CONFIG.QUEUE_KEY, JSON.stringify(retryable));
      console.warn('[Sync] Retry failed with HTTP ' + code + ' — will retry later');
    }
    
  } catch (err) {
    // Network error — increment counts and keep in queue
    retryable.forEach(function(e) { e.retryCount++; });
    sp.setProperty(SYNC_CONFIG.QUEUE_KEY, JSON.stringify(retryable));
    console.error('[Sync] Retry network error: ' + err.toString());
  }
}


// ─────────────────────────────────────────────────────────────
//  VIEW PENDING SYNCS — For debugging
// ─────────────────────────────────────────────────────────────
function viewPendingSyncs() {
  var ui = SpreadsheetApp.getUi();
  var sp = PropertiesService.getScriptProperties();
  var queue = JSON.parse(sp.getProperty(SYNC_CONFIG.QUEUE_KEY) || '[]');
  
  if (queue.length === 0) {
    ui.alert('📭 No Pending Syncs', 'The dead letter queue is empty.', ui.ButtonSet.OK);
    return;
  }
  
  var summary = queue.slice(0, 10).map(function(e) {
    return '• Row ' + e.row + ': ' + e.field + ' → "' + (e.newValue || '').substring(0, 20) + 
           '" (retries: ' + e.retryCount + ', reason: ' + e.failReason + ')';
  }).join('\n');
  
  if (queue.length > 10) {
    summary += '\n\n... and ' + (queue.length - 10) + ' more';
  }
  
  ui.alert('📬 Pending Syncs: ' + queue.length, summary, ui.ButtonSet.OK);
}


// ─────────────────────────────────────────────────────────────
//  CLEAR DEAD LETTER QUEUE — Manual reset
// ─────────────────────────────────────────────────────────────
function clearDeadLetterQueue() {
  var ui = SpreadsheetApp.getUi();
  var sp = PropertiesService.getScriptProperties();
  var queue = JSON.parse(sp.getProperty(SYNC_CONFIG.QUEUE_KEY) || '[]');
  
  if (queue.length === 0) {
    ui.alert('📭 Already Empty', 'No pending syncs to clear.', ui.ButtonSet.OK);
    return;
  }
  
  var result = ui.alert('⚠️ Clear ' + queue.length + ' Pending Syncs?',
    'This will discard all failed syncs without retrying.\n\n' +
    'The edits exist in the Sheet but won\'t sync to Firestore.\n\n' +
    'Continue?', ui.ButtonSet.YES_NO);
    
  if (result !== ui.Button.YES) return;
  
  sp.setProperty(SYNC_CONFIG.QUEUE_KEY, '[]');
  ui.alert('✅ Cleared', 'Dead letter queue cleared.', ui.ButtonSet.OK);
}


// ─────────────────────────────────────────────────────────────
//  SETUP / REMOVE / STATUS — menu entry points
// ─────────────────────────────────────────────────────────────

function setupSyncTrigger() {
  var ui = SpreadsheetApp.getUi();

  var existingTriggers = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === 'onSheetEditSync' ||
           t.getHandlerFunction() === 'processPendingSyncs';
  });

  if (existingTriggers.length > 0) {
    ui.alert('⚡ Already Active',
      'Sync triggers already installed.\n\n' +
      'To reinstall, remove them first via:\nCRM Add-Ons → Firebase → ❌ Remove Realtime Sync',
      ui.ButtonSet.OK);
    return;
  }

  // Ensure Cloud Function URL is set
  var cfUrl = CRM.PROPS.CLOUD_FUNCTION_URL;
  if (!cfUrl) {
    var r = ui.prompt('🔗 Cloud Function URL Required',
      'Enter your Cloud Function URL:', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    cfUrl = r.getResponseText().trim();
    if (!cfUrl) { ui.alert('Error', 'URL cannot be empty.', ui.ButtonSet.OK); return; }
    saveProp('CLOUD_FUNCTION_URL', cfUrl);
  }

  // Install onEdit trigger
  ScriptApp.newTrigger('onSheetEditSync')
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();

  // Install time-based trigger for retry processing
  ScriptApp.newTrigger('processPendingSyncs')
    .timeBased()
    .everyMinutes(1)
    .create();

    var trackedList = Object.keys(CRM.SYNC.TRACKED_HEADERS).map(function(header) {
      return '• ' + header + ' → ' + CRM.SYNC.TRACKED_HEADERS[header];
    }).join('\n');

    ui.alert('⚡ Sync Activated!',
      'Real-time Sheet → Firestore sync is now active.\n\n' +
      '✅ Edit trigger installed\n' +
      '✅ Retry job installed (every 1 min)\n\n' +
      'Tracked columns:\n' + trackedList + '\n\n' +
      'Failed syncs are automatically retried up to 3 times.\n\n' +
      'To disable: CRM Add-Ons → Firestore Sync → ⏹️ Remove Realtime Sync',
      ui.ButtonSet.OK);
}


function removeSyncTrigger() {
  var ui = SpreadsheetApp.getUi();
  var triggers = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === 'onSheetEditSync' ||
           t.getHandlerFunction() === 'processPendingSyncs';
  });

  if (triggers.length === 0) {
    ui.alert('Not Active', 'No sync triggers found.', ui.ButtonSet.OK);
    return;
  }

  // Check dead letter queue
  var sp = PropertiesService.getScriptProperties();
  var queue = JSON.parse(sp.getProperty(SYNC_CONFIG.QUEUE_KEY) || '[]');
  var queueWarning = queue.length > 0 
    ? '\n\n⚠️ Warning: ' + queue.length + ' pending sync(s) in queue will NOT be processed.'
    : '';

  if (ui.alert('⚠️ Disable Sync?',
    'Stop real-time Sheet → Firestore sync?' + queueWarning, 
    ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  // Remove triggers
  triggers.forEach(function(t) { ScriptApp.deleteTrigger(t); });

  ui.alert('✅ Sync Disabled', 
    'Triggers removed. Edits no longer sync to Firestore.\n\n' +
    (queue.length > 0 ? 'Note: ' + queue.length + ' pending sync(s) were left in queue.' : ''),
    ui.ButtonSet.OK);
}


function checkSyncTriggerStatus() {
  var ui = SpreadsheetApp.getUi();
  
  var onEditTrigger = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === 'onSheetEditSync';
  });
  
  var retryTrigger = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === 'processPendingSyncs';
  });

  var cfUrl = CRM.PROPS.CLOUD_FUNCTION_URL || 'NOT SET';
  
  // Check dead letter queue
  var sp = PropertiesService.getScriptProperties();
  var queue = JSON.parse(sp.getProperty(SYNC_CONFIG.QUEUE_KEY) || '[]');

  // Build tracked headers list
  var trackedList = Object.keys(CRM.SYNC.TRACKED_HEADERS).map(function(header) {
    return '• ' + header + ' → ' + CRM.SYNC.TRACKED_HEADERS[header];
  }).join('\n');

  var status = 
    '📡 Edit Trigger: ' + (onEditTrigger.length > 0 ? '✅ Active' : '❌ Not installed') + '\n' +
    '🔄 Retry Trigger: ' + (retryTrigger.length > 0 ? '✅ Active' : '❌ Not installed') + '\n\n' +
    '🔗 Cloud Function:\n' + cfUrl + '\n\n' +
    '📬 Dead Letter Queue: ' + queue.length + ' pending\n\n' +
    'Tracked columns:\n' + trackedList;

  ui.alert('⚡ Sync Status', status, ui.ButtonSet.OK);
}

/**
 * Get editor email using multiple fallback methods
 */
function _getEditorEmail(e) {
  // Method 1: e.user (works in some Workspace setups)
  try {
    if (e && e.user && e.user.getEmail()) {
      return e.user.getEmail();
    }
  } catch (err) {}
  
  // Method 2: Session.getActiveUser (works if user authorized)
  try {
    var email = Session.getActiveUser().getEmail();
    if (email) return email;
  } catch (err) {}
  
  // Method 3: Check user properties (set during authorization)
  try {
    var userProps = PropertiesService.getUserProperties();
    var storedEmail = userProps.getProperty('USER_EMAIL');
    if (storedEmail) return storedEmail;
  } catch (err) {}
  
  return 'unknown';
}