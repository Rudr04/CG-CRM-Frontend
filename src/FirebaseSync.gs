// ============================================================================
//  FirebaseSync.gs — Firebase Whitelist Operations
//  Credentials: FIREBASE_DATABASE_URL + FIREBASE_SECRET in Script Properties
// ============================================================================

/** Core: PUT a single phone into Firebase whitelist */
function _fbPut(phoneNumber, name, source) {
  var url    = CRM.PROPS.FIREBASE_URL;
  var secret = CRM.PROPS.FIREBASE_SECRET;
  if (!secret || !url) throw new Error('Firebase credentials not configured');

  var safeName = String(name || '').trim();
  if (!safeName) throw new Error('Name cannot be empty');

  var sanitized = '+' + phoneNumber.toString().replace(/\D/g, '');
  UrlFetchApp.fetch(url + 'whitelist/' + sanitized + '.json?auth=' + secret, {
    method: 'put', contentType: 'application/json',
    payload: JSON.stringify({ name: safeName, source: source || 'sheet_sync' }),
  });
}


// ────────────────────────────────────────────────────────────────
//  Menu entry points (top-level — required for menu bindings)
// ────────────────────────────────────────────────────────────────

/** Sync a range of rows to Firebase */
function syncAllToFirebase() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();

  try {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) { ui.alert('No Data', 'No data found to sync.', ui.ButtonSet.OK); return; }

    // Step 1: Row range
    var r1 = ui.prompt('📊 Step 1/3 — Row Range',
      'Total rows: ' + (lastRow - 1) + ' (2 to ' + lastRow + ')\n\nEnter range (e.g. "2-500").\nLeave blank for all.',
      ui.ButtonSet.OK_CANCEL);
    if (r1.getSelectedButton() !== ui.Button.OK) return;

    var startRow = 2, endRow = lastRow;
    var ri = r1.getResponseText().trim();
    if (ri) {
      var parts = ri.split('-').map(function(x) { return parseInt(x.trim()); });
      if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) { ui.alert('Error', 'Use format "2-500"', ui.ButtonSet.OK); return; }
      startRow = Math.max(2, parts[0]);
      endRow   = Math.min(lastRow, parts[1]);
    }

    // Step 2: Name column
    var r2 = ui.prompt('📋 Step 2/3 — Name Column', 'Column letter for NAME (e.g. D):', ui.ButtonSet.OK_CANCEL);
    if (r2.getSelectedButton() !== ui.Button.OK) return;
    var ncl = r2.getResponseText().trim().toUpperCase();
    if (!/^[A-Z]+$/.test(ncl)) { ui.alert('Error', 'Invalid column letter', ui.ButtonSet.OK); return; }

    // Step 3: Phone column
    var r3 = ui.prompt('📋 Step 3/3 — Phone Column', 'Column letter for PHONE (e.g. E):', ui.ButtonSet.OK_CANCEL);
    if (r3.getSelectedButton() !== ui.Button.OK) return;
    var pcl = r3.getResponseText().trim().toUpperCase();
    if (!/^[A-Z]+$/.test(pcl)) { ui.alert('Error', 'Invalid column letter', ui.ButtonSet.OK); return; }

    var toIdx = function(col) { return col.split('').reduce(function(a, c) { return a * 26 + c.charCodeAt(0) - 64; }, 0); };
    var ni = toIdx(ncl), pi = toIdx(pcl);
    var sc = Math.min(ni, pi), ec = Math.max(ni, pi);
    var nOff = ni - sc, pOff = pi - sc;
    var numRows = endRow - startRow + 1;

    ss.toast('Scanning rows ' + startRow + '–' + endRow + '...', 'Please Wait', 3);
    var data = sheet.getRange(startRow, sc, numRows, ec - sc + 1).getValues();

    var valid = [], empty = 0;
    for (var i = 0; i < data.length; i++) {
      var n = String(data[i][nOff] || '').trim();
      var p = String(data[i][pOff] || '').trim();
      if (n && p) valid.push({ name: n, phone: p, row: startRow + i });
      else empty++;
    }

    if (!valid.length) {
      ui.alert('No Data', 'No valid rows in range.\nEmpty/incomplete: ' + empty, ui.ButtonSet.OK);
      return;
    }

    if (ui.alert('🔥 Ready to Sync',
      '📊 Valid: ' + valid.length + '\n📍 Rows: ' + startRow + '–' + endRow +
      '\n⬜ Skipped: ' + empty + '\n👤 Name: Col ' + ncl + '\n📞 Phone: Col ' + pcl +
      '\n\nProceed?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

    var synced = 0, errors = 0, errList = [];
    ss.toast('Syncing ' + valid.length + ' numbers...', 'In Progress', -1);

    valid.forEach(function(item, idx) {
      try {
        _fbPut(item.phone, item.name, 'sheet_sync');
        synced++;
        if ((idx + 1) % 50 === 0) ss.toast('Synced ' + (idx + 1) + '/' + valid.length, 'In Progress', 2);
      } catch (e) {
        errors++;
        errList.push('Row ' + item.row + ': ' + e);
      }
    });

    var msg = '✅ Synced: ' + synced + '\n❌ Errors: ' + errors;
    if (errList.length) msg += '\n\nFirst 3 errors:\n' + errList.slice(0, 3).join('\n');
    ui.alert('✅ Sync Complete', msg, ui.ButtonSet.OK);
    ss.toast('Sync complete!', 'Done', 3);

  } catch (error) {
    Logger.log('syncAllToFirebase: ' + error);
    ui.alert('Error', '❌ ' + error, ui.ButtonSet.OK);
  }
}


/** Add a single number manually */
function addSingleToWhitelist() {
  var ui = SpreadsheetApp.getUi();

  try {
    // Check credentials first
    if (!CRM.PROPS.FIREBASE_SECRET || !CRM.PROPS.FIREBASE_URL) {
      ui.alert('⚠️ Not Configured', 'Setup Firebase credentials first.', ui.ButtonSet.OK);
      return;
    }

    var r1 = ui.prompt('➕ Whitelist — Step 1/2', 'Enter NAME:', ui.ButtonSet.OK_CANCEL);
    if (r1.getSelectedButton() !== ui.Button.OK) return;
    var name = r1.getResponseText().trim();
    if (!name) { ui.alert('Error', 'Name cannot be empty.', ui.ButtonSet.OK); return; }

    var r2 = ui.prompt('➕ Whitelist — Step 2/2', 'Enter PHONE NUMBER:\n(digits only, + added automatically)', ui.ButtonSet.OK_CANCEL);
    if (r2.getSelectedButton() !== ui.Button.OK) return;
    var phone = '+' + r2.getResponseText().trim().replace(/\D/g, '');
    if (phone.length < 10) { ui.alert('Error', 'At least 10 digits required.', ui.ButtonSet.OK); return; }

    if (ui.alert('Confirm', '👤 ' + name + '\n📞 ' + phone + '\n\nAdd to whitelist?',
        ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

    _fbPut(phone, name, 'manual_entry');
    ui.alert('✅ Success', 'Added: ' + name + ' — ' + phone, ui.ButtonSet.OK);

  } catch (error) {
    ui.alert('Error', '❌ ' + error, ui.ButtonSet.OK);
  }
}


/** Check Firebase connection status */
function checkSyncStatus() {
  var ui  = SpreadsheetApp.getUi();
  var url = CRM.PROPS.FIREBASE_URL;
  var key = CRM.PROPS.FIREBASE_SECRET;

  ui.alert('🔥 Firebase Status',
    (url && key ? '✅ Credentials configured' : '⚠️ Credentials missing') +
    '\n🔗 URL: ' + (url || '—') +
    '\n🔑 Secret: ' + (key ? '***set***' : '—'),
    ui.ButtonSet.OK);
}


/** Setup Firebase credentials via prompts */
function setupCredentials() {
  var ui = SpreadsheetApp.getUi();

  var r1 = ui.prompt('🔥 Firebase — Step 1/2', 'Database URL:\n(e.g. https://your-project.firebaseio.com/)', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var dbUrl = r1.getResponseText().trim();
  if (!dbUrl) { ui.alert('Error', 'URL cannot be empty', ui.ButtonSet.OK); return; }

  var r2 = ui.prompt('🔥 Firebase — Step 2/2', 'Database Secret:', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  var secret = r2.getResponseText().trim();
  if (!secret) { ui.alert('Error', 'Secret cannot be empty', ui.ButtonSet.OK); return; }

  saveProp('FIREBASE_URL', dbUrl);
  saveProp('FIREBASE_SECRET', secret);
  ui.alert('✅ Saved', 'Firebase credentials saved. Ready to sync.', ui.ButtonSet.OK);
}
