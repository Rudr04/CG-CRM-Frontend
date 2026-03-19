// ============================================================================
//  WatiChat.gs — WhatsApp Chat Sidebar (server-side)
//  Polls WATI getMessages API for live-feel updates.
//  Agents: read messages, reply, send templates, update status.
//  HTML: ChatSidebar.html (loaded via createTemplateFromFile)
// ============================================================================


// ── Menu entry point ───────────────────────────────────────────

function openChatSidebar() {
  var ui    = SpreadsheetApp.getUi();
  var sheet = getSheet(CRM.SHEETS.DSR);
  if (!sheet) { ui.alert(CRM.SHEETS.DSR + ' not found.'); return; }

  var row = sheet.getActiveRange() ? sheet.getActiveRange().getRow() : 0;
  if (row < 2) { ui.alert('Select a lead row first (row 2 or below).'); return; }

  var lead = getLeadData(sheet, row);
  if (!lead) return;

  var tpl = HtmlService.createTemplateFromFile('ChatSidebar');
  tpl.lead    = lead;
  tpl.pollMs  = CRM.CHAT_POLL_MS;
  tpl.statuses = CRM.STATUSES;

  var title = '\u{1F4AC} ' + (lead.name || lead.number);
  ui.showSidebar(tpl.evaluate().setTitle(title).setWidth(400));
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

    // WATI returns newest-first; reverse so oldest is at top
    var messages = raw.reverse().map(function(m) {
      return {
        id:        m.id || m.whatsappMessageId || '',
        text:      m.text || m.body || '',
        timestamp: m.timestamp || m.created || '',
        direction: m.owner ? 'out' : 'in',
        type:      m.type || 'text',
        status:    m.statusString || m.status || '',
      };
    });

    return { ok: true, messages: messages };
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

    if (newStatus) {
      sheet.getRange(rowIndex, C.STATUS + 1).setValue(newStatus);
    }
    if (appendRemark && appendRemark.trim()) {
      var current  = (sheet.getRange(rowIndex, C.REMARK + 1).getValue() || '').toString().trim();
      var combined = current ? (current + ' | ' + appendRemark.trim()) : appendRemark.trim();
      sheet.getRange(rowIndex, C.REMARK + 1).setValue(combined);
    }

    return { ok: true };
  } catch (e) {
    console.error('[Chat] updateStatus: ' + e.message);
    return { ok: false, error: e.message };
  }
}