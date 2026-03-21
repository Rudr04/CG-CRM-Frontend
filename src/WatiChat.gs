// ============================================================================
//  WatiChat.gs — WhatsApp Chat Sidebar (server-side)
//  Polls WATI getMessages API for live-feel updates.
//  Agents: read messages, reply, send templates, update status.
//  HTML: ChatSidebar.html (loaded via createTemplateFromFile)
// ============================================================================


// ── Menu entry point ───────────────────────────────────────────


// Add at top of WatiChat.gs
var FLOW_BODY_TEXT = {
  'MC Regi Form 23': 'માત્ર એક સ્ટેપ\nઆપનાં FREE રેજીસ્ટ્રેશન માટે\n\nNEXT LEVEL જ્યોતિષ શીખો\n\nરવિવાર, 15 FEB 2026\n\n🏛 અમદાવાદ ઓફલાઇન ક્લાસ સવારે 10:30\n💻 ઓનલાઇન ક્લાસ બપોરે 4:30\n\nમાસ્ટરક્લાસની અન્ય તમામ વિગતો આપનાં રેજીસ્ટર નંબર પર મળશે',
  // Add more flows as needed:
  // 'Another Flow Name': 'Body text here...',
};

function openChatSidebar() {
  var ui    = SpreadsheetApp.getUi();
  var sheet = getSheet(CRM.SHEETS.DSR);
  if (!sheet) { ui.alert(CRM.SHEETS.DSR + ' not found.'); return; }

  var row = sheet.getActiveRange() ? sheet.getActiveRange().getRow() : 0;
  if (row < 2) { ui.alert('Select a lead row first (row 2 or below).'); return; }

  var lead = getLeadData(sheet, row);
  if (!lead) return;
  // Debug — check what's being passed to sidebar

  var tpl = HtmlService.createTemplateFromFile('ChatSidebar');
  tpl.lead    = lead;
  tpl.pollMs  = CRM.CHAT_POLL_MS;
  tpl.statuses = CRM.STATUSES;

  var title = '\u{1F4AC} ' + (lead.name || lead.number);
  ui.showSidebar(tpl.evaluate().setTitle(title));
}

// ── WATI Configuration ─────────────────────────────────────────

function _watiCfg() {
  var base   = CRM.PROPS.WATI_BASE_URL;
  var token  = CRM.PROPS.WATI_BEARER_TOKEN;
  var tenant = CRM.PROPS.WATI_TENANT_ID;
  if (!base || !token || !tenant) {
    throw new Error('WATI credentials not set (WATI_BASE_URL, WATI_BEARER_TOKEN, WATI_TENANT_ID).');
  }
  return { base: base, token: token, tenant: tenant };
}


// ── Fetch Messages (called from sidebar polling) ───────────────

// ── Flow config — add your flows here ──
var FLOW_CONFIG = {
  'MC Regi Form 23': 'માત્ર એક સ્ટેપ\nઆપનાં FREE રેજીસ્ટ્રેશન માટે\n\nNEXT LEVEL જ્યોતિષ શીખો\n\nરવિવાર, 15 FEB 2026\n\n🏛 અમદાવાદ ઓફલાઇન ક્લાસ સવારે 10:30\n💻 ઓનલાઇન ક્લાસ બપોરે 4:30\n\nમાસ્ટરક્લાસની અન્ય તમામ વિગતો આપનાં રેજીસ્ટર નંબર પર મળશે',
  // Add more flows:
  // 'Flow Name': 'Full body text here...',
};

function fetchWatiMessages(phoneNumber) {
  try {
    var cfg   = _watiCfg();
    var clean = phoneNumber.toString().replace(/\D/g, '');
    var url   = cfg.base + cfg.tenant + '/api/v1/getMessages/' + clean + '?pageSize=50&pageIndex=0';

    var resp = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + cfg.token, 'accept': 'application/json' },
      muteHttpExceptions: true,
    });

    if (resp.getResponseCode() !== 200) {
      console.error('[Chat] getMessages HTTP ' + resp.getResponseCode());
      return { ok: false, messages: [], error: 'HTTP ' + resp.getResponseCode() };
    }

    var body = JSON.parse(resp.getContentText());
    var raw  = (body.messages && body.messages.items) ? body.messages.items : [];

    // Get template header image map (cached)
    var tplHeaders = _getTemplateHeaderMap();
    
    // WATI returns newest-first; reverse so oldest is at top
    var messages = raw.reverse()
      .filter(function(m) {
        return m.eventType === 'message' || m.eventType === 'broadcastMessage';
      }).map(function(m) {
        var isOutbound = !!m.owner || !!m.operaterName || !!m.operater || m.eventType == 'broadcastMessage';
        var type = m.type || 'text';

        // Media info for images/files
        var mediaPath = m.data || null;
        var mediaType = null;
        if (type === 'image' || type === 'video' || type === 'document' || type === 'audio' || type === 'sticker') {
          mediaType = type;
        }

        // For broadcastMessages, extract template name and check for header image
        var tplImageUrl = null;
        if (m.eventType === 'broadcastMessage' && m.eventDescription) {
          var tplMatch = m.eventDescription.match(/"([^"]+)"/);
          if (tplMatch && tplMatch[1] && tplHeaders[tplMatch[1]]) {
            tplImageUrl = tplHeaders[tplMatch[1]];
          }
        }

        return {
          id:        m.id || m.whatsappMessageId || '',
          text:      FLOW_BODY_TEXT[m.text] || m.text || m.body || m.finalText || '',
          timestamp: m.timestamp || m.created || '',
          direction: isOutbound ? 'out' : 'in',
          type:      type,
          status:    m.statusString || m.status || '',
          mediaPath: mediaPath,
          mediaType: mediaType,
          tplImageUrl: tplImageUrl,
        };
      });

    // Find last inbound message timestamp for 24hr session check
    var lastInboundTs = null;
    for (var i = messages.length - 1; i >= 0; i--) {
      if (messages[i].direction === 'in') {
        lastInboundTs = messages[i].timestamp;
        break;
      }
    }

    return { ok: true, messages: messages, lastInboundTs: lastInboundTs };
  } catch (e) {
    console.error('[Chat] fetchMessages: ' + e.message);
    return { ok: false, messages: [], error: e.message };
  }
}
// ── Send Free-Text Message ─────────────────────────────────────

function sendWatiMessage(phoneNumber, messageText) {
  if (!messageText || !messageText.trim()) return { ok: false, error: 'Empty message' };

  try {
    var cfg   = _watiCfg();
    var clean = phoneNumber.toString().replace(/\D/g, '');
    var url   = cfg.base + cfg.tenant + '/api/v1/sendSessionMessage/' + clean
              + '?messageText=' + encodeURIComponent(messageText.trim());

    var resp = UrlFetchApp.fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + cfg.token, 'accept': 'application/json' },
      muteHttpExceptions: true,
    });

    var code = resp.getResponseCode();
    var body = JSON.parse(resp.getContentText());

    if (code === 200) {
      console.log('[Chat] Sent to ' + clean + ': "' + messageText.trim().substring(0, 50) + '"');
      return { ok: true };
    }
    console.error('[Chat] sendSession ' + code + ': ' + JSON.stringify(body));
    return { ok: false, error: body.message || ('HTTP ' + code) };
  } catch (e) {
    console.error('[Chat] sendMessage: ' + e.message);
    return { ok: false, error: e.message };
  }
}


// ── Send Template Message ──────────────────────────────────────

function sendWatiTemplate(phoneNumber, templateName, parameters) {
  try {
    var cfg   = _watiCfg();
    var clean = phoneNumber.toString().replace(/\D/g, '');
    var url   = cfg.base + cfg.tenant + '/api/v1/sendTemplateMessage?whatsappNumber=' + clean;

    var payload = {
      template_name:  templateName,
      broadcast_name: 'CRM_Manual',
      parameters:     parameters || [],
    };

    var resp = UrlFetchApp.fetch(url, {
      method: 'POST', contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + cfg.token },
      payload: JSON.stringify(payload), muteHttpExceptions: true,
    });

    var code = resp.getResponseCode();
    var body = JSON.parse(resp.getContentText());

    if (code === 200) {
      console.log('[Chat] Template "' + templateName + '" sent to ' + clean);
      return { ok: true };
    }
    return { ok: false, error: body.message || ('HTTP ' + code) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Send File via WATI ─────────────────────────────────────────

function sendWatiFile(phoneNumber, fileName, base64Data, mimeType) {
  if (!base64Data) return { ok: false, error: 'No file data' };

  try {
    var cfg   = _watiCfg();
    var clean = phoneNumber.toString().replace(/\D/g, '');
    var url   = cfg.base + cfg.tenant + '/api/v1/sendSessionFile/' + clean;

    var fileBlob = Utilities.newBlob(
      Utilities.base64Decode(base64Data),
      mimeType || 'application/octet-stream',
      fileName
    );

    var resp = UrlFetchApp.fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + cfg.token },
      payload: { file: fileBlob },
      muteHttpExceptions: true,
    });

    var code = resp.getResponseCode();
    var body = JSON.parse(resp.getContentText());

    if (code === 200) {
      console.log('[Chat] File sent to ' + clean + ': ' + fileName);
      return { ok: true };
    }
    console.error('[Chat] sendFile ' + code + ': ' + JSON.stringify(body));
    return { ok: false, error: body.message || ('HTTP ' + code) };
  } catch (e) {
    console.error('[Chat] sendFile: ' + e.message);
    return { ok: false, error: e.message };
  }
}


// ── Fetch Approved Templates ───────────────────────────────────

function fetchWatiTemplates() {
  try {
    var cfg = _watiCfg();
    var url = cfg.base + cfg.tenant + '/api/v1/getMessageTemplates?pageSize=100&pageIndex=0';

    var resp = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + cfg.token, 'accept': 'application/json' },
      muteHttpExceptions: true,
    });

    var body = JSON.parse(resp.getContentText());
    var all  = body.messageTemplates || [];

    var templates = all
      .filter(function(t) { return (t.status || '').toLowerCase() === 'approved'; })
      .map(function(t) {
        var bodyText   = t.body || '';
        var paramCount = (bodyText.match(/\{\{\d+\}\}/g) || []).length;
        return { name: t.elementName || t.name || '', body: bodyText, category: t.category || '', params: paramCount };
      });

    return { ok: true, templates: templates };
  } catch (e) {
    console.error('[Chat] fetchTemplates: ' + e.message);
    return { ok: false, templates: [], error: e.message };
  }
}


// ── Update Lead Status From Chat ───────────────────────────────

function updateLeadStatusFromChat(rowIndex, newStatus, appendRemark) {
  try {
    var C     = CRM.COL;
    var sheet = getSheet(CRM.SHEETS.DSR);
    var edits = [];
    var editor = Session.getEffectiveUser().getEmail() || 'chat_sidebar';

    // Get phone number for Firestore lookup
    var phone = (sheet.getRange(rowIndex, C.NUMBER + 1).getValue() || '').toString().trim();

    // Get current row data for sync payload
    var rowData = {
      name:     sheet.getRange(rowIndex, C.NAME + 1).getValue() || '',
      team:     sheet.getRange(rowIndex, C.TEAM + 1).getValue() || '',
      status:   newStatus || sheet.getRange(rowIndex, C.STATUS + 1).getValue() || '',
      location: sheet.getRange(rowIndex, C.LOCATION + 1).getValue() || '',
      inquiry:  sheet.getRange(rowIndex, C.INQUIRY + 1).getValue() || '',
      product:  sheet.getRange(rowIndex, C.PRODUCT + 1).getValue() || '',
    };

    if (newStatus) {
      var oldStatus = sheet.getRange(rowIndex, C.STATUS + 1).getDisplayValue();
      sheet.getRange(rowIndex, C.STATUS + 1).setValue(newStatus);

      if (phone) {
        edits.push({
          row:        rowIndex,
          phone:      phone,
          field:      'status',
          oldValue:   oldStatus,
          newValue:   newStatus,
          action:     CRM.SYNC.HISTORY_ACTIONS['status'] || 'status_changed',
          timestamp:  new Date().getTime(),
          retryCount: 0,
          rowData:    rowData,
        });
      }
    }

    if (appendRemark && appendRemark.trim()) {
      var current  = (sheet.getRange(rowIndex, C.REMARK + 1).getValue() || '').toString().trim();
      var combined = current ? (current + ' | ' + appendRemark.trim()) : appendRemark.trim();
      sheet.getRange(rowIndex, C.REMARK + 1).setValue(combined);

      if (phone) {
        edits.push({
          row:        rowIndex,
          phone:      phone,
          field:      'remark',
          oldValue:   current,
          newValue:   combined,
          action:     CRM.SYNC.HISTORY_ACTIONS['remark'] || 'remark_updated',
          timestamp:  new Date().getTime(),
          retryCount: 0,
          rowData:    rowData,
        });
      }
    }

    // Sync to Firestore via Cloud Function
    if (edits.length > 0) {
      _sendEditsToCloudFunction(edits, editor);
    }

    return { ok: true };
  } catch (e) {
    console.error('[Chat] updateStatus: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ── Fetch media file as base64 ─────────────────────────────────

function getWatiMedia(filePath) {
  try {
    var cfg = _watiCfg();
    var url = cfg.base + cfg.tenant + '/api/v1/getMedia?fileName=' + encodeURIComponent(filePath);

    var resp = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + cfg.token },
      muteHttpExceptions: true,
    });

    if (resp.getResponseCode() !== 200) {
      return { ok: false, error: 'HTTP ' + resp.getResponseCode() };
    }

    var blob = resp.getBlob();
    var base64 = Utilities.base64Encode(blob.getBytes());
    var mime = blob.getContentType() || 'image/jpeg';

    return { ok: true, data: 'data:' + mime + ';base64,' + base64 };
  } catch (e) {
    console.error('[Chat] getMedia: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ── Get viewable URL for PDF via Google Drive ──────────────────

function getWatiPdfViewUrl(filePath) {
  try {
    var cfg = _watiCfg();
    var url = cfg.base + cfg.tenant + '/api/v1/getMedia?fileName=' + encodeURIComponent(filePath);

    var resp = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + cfg.token },
      muteHttpExceptions: true,
    });

    if (resp.getResponseCode() !== 200) {
      return { ok: false, error: 'HTTP ' + resp.getResponseCode() };
    }

    var blob = resp.getBlob();
    var fileName = filePath.split('/').pop() || 'document.pdf';
    blob.setName(fileName);

    // Save to Drive in a temp folder
    var folder;
    var folders = DriveApp.getFoldersByName('_CRM_Temp_Media');
    if (folders.hasNext()) {
      folder = folders.next();
    } else {
      folder = DriveApp.createFolder('_CRM_Temp_Media');
    }

    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var fileId = file.getId();
    var viewUrl = 'https://drive.google.com/file/d/' + fileId + '/preview';

    return { ok: true, viewUrl: viewUrl, fileId: fileId };
  } catch (e) {
    console.error('[Chat] getPdfViewUrl: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ── Template header image cache ────────────────────────────────

function _getTemplateHeaderMap() {
  // Check cache first (10 min TTL)
  var cache = CacheService.getScriptCache();
  var cached = cache.get('tplHeaderMap');
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }

  try {
    var cfg = _watiCfg();
    var url = cfg.base + cfg.tenant + '/api/v1/getMessageTemplates?pageSize=100&pageIndex=0';
    var resp = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + cfg.token, 'accept': 'application/json' },
      muteHttpExceptions: true,
    });

    var body = JSON.parse(resp.getContentText());
    var all = body.messageTemplates || [];
    var map = {};

    all.forEach(function(t) {
      if (t.header && t.header.typeString === 'image' && t.header.mediaFromPC) {
        map[t.elementName || t.name] = 'data/images/' + t.header.mediaFromPC;
      }
    });

    cache.put('tplHeaderMap', JSON.stringify(map), 21600); // 6 hours
    return map;
  } catch (e) {
    console.error('[Chat] getTemplateHeaderMap: ' + e.message);
    return {};
  }
}