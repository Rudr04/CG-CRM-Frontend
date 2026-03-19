// ============================================================================
//  SmartfloDialer.gs — Smartflo Click-to-Call (C2C)
//  Agent identity: looked up by Google email from Agent_Config tab
//  Call flow: Agent's softphone rings → bridges to lead
//
//  HTML templates: CallSidebar.html, AdminSetup.html, CallLog.html
// ============================================================================


// ── Menu entry points ──────────────────────────────────────────

function openCallSidebar() {
  var ui = SpreadsheetApp.getUi();
  var sheet = SpreadsheetApp.getActiveSheet();

  if (sheet.getName() !== CRM.SHEETS.DSR) {
    ui.alert('Wrong Sheet', 'Select a lead row on "' + CRM.SHEETS.DSR + '" first.', ui.ButtonSet.OK);
    return;
  }

  var row = sheet.getActiveRange() ? sheet.getActiveRange().getRow() : 0;
  if (!row || row <= CRM.HEADER_ROW) {
    ui.alert('No Row Selected', 'Click on a lead row first, then open the dialer.', ui.ButtonSet.OK);
    return;
  }

  var lead = getLeadData(sheet, row);
  if (!lead) return;

  var agent = getAgentByEmail(Session.getActiveUser().getEmail());
  var isConfigured = !!CRM.PROPS.SMARTFLO_C2C_TOKEN;

  var tpl  = HtmlService.createTemplateFromFile('CallSidebar');
  tpl.lead = lead;
  tpl.agent = agent;
  tpl.isConfigured = isConfigured;
  tpl.configSheet  = CRM.SHEETS.AGENT_CONFIG;

  ui.showSidebar(tpl.evaluate().setTitle('📞 Call Lead').setWidth(320));
}


function openAdminSetup() {
  var tpl = HtmlService.createTemplateFromFile('AdminSetup');
  tpl.hasToken = !!CRM.PROPS.SMARTFLO_C2C_TOKEN;
  SpreadsheetApp.getUi().showSidebar(
    tpl.evaluate().setTitle('🔑 Smartflo API Setup').setWidth(380));
}


function openCallLog() {
  var C = CRM.COL;
  var sheet = getSheet(CRM.SHEETS.DSR);
  if (!sheet) { SpreadsheetApp.getUi().alert(CRM.SHEETS.DSR + ' not found'); return; }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { SpreadsheetApp.getUi().alert('No data yet.'); return; }

  var data = sheet.getRange(2, 1, lastRow - 1, C.ACTION + 2).getValues();

  // Filter rows that have call log entries (📞 marker)
  var called = data
    .filter(function(r) { return (r[C.ACTION] || '').toString().indexOf('📞') >= 0; })
    .slice(-30).reverse();

  var tpl = HtmlService.createTemplateFromFile('CallLog');
  tpl.called = called;
  tpl.COL    = C;

  SpreadsheetApp.getUi().showSidebar(
    tpl.evaluate().setTitle('📊 Call Log').setWidth(520));
}


// ── Server-side: trigger the C2C call (called from sidebar) ────

function triggerC2CCall(rowIndex) {
  try {
    var C = CRM.COL;
    var sheet = getSheet(CRM.SHEETS.DSR);
    var rowData = sheet.getRange(rowIndex, 1, 1, 20).getValues()[0];
    var leadNumber = (rowData[C.NUMBER] || '').toString().trim();
    var leadName   = (rowData[C.NAME]   || '').toString().trim() || 'Lead';

    if (!leadNumber) throw new Error('No phone number in row ' + rowIndex);

    var email = Session.getActiveUser().getEmail();
    var agent = getAgentByEmail(email);
    if (!agent) throw new Error('Your email (' + email + ') is not in ' + CRM.SHEETS.AGENT_CONFIG);

    var cleanLead = cleanPhone(leadNumber);
    var agentId   = cleanAgentId(agent.phone);

    if (cleanLead.length < 10) throw new Error('Invalid lead number: ' + leadNumber);
    if (!agentId) throw new Error('Smartflo Agent ID missing for: ' + agent.name);

    _callSmartfloC2C(agentId, cleanLead);
    _logCallToRow(sheet, rowIndex, agent.name, agentId);

    return { success: true, message: 'Calling your softphone now. Connecting to ' + leadName + ' once you answer.' };
  } catch (err) {
    console.error('triggerC2CCall: ' + err.message);
    return { success: false, message: err.message };
  }
}

function saveSmartfloToken(token) {
  saveProp('SMARTFLO_C2C_TOKEN', token);
  console.log('Smartflo token saved');
}


// ── Agent Config Tab Setup ─────────────────────────────────────

function setupAgentConfigSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var tabName = CRM.SHEETS.AGENT_CONFIG;
  var sheet = ss.getSheetByName(tabName);

  if (sheet) {
    ui.alert('Already Exists', '"' + tabName + '" tab exists. Edit it directly.', ui.ButtonSet.OK);
    ss.setActiveSheet(sheet);
    return;
  }

  sheet = ss.insertSheet(tabName);
  var headers = ['Agent Name', 'Google Email', 'Smartflo Agent ID', 'Team'];
  sheet.getRange(1, 1, 1, 4).setValues([headers])
    .setBackground('#1a73e8').setFontColor('#fff').setFontWeight('bold').setFontSize(12);

  sheet.getRange(2, 1, 1, 4).setValues([['Example Agent', 'agent@gmail.com', '0507296220001', 'Sales Team A']])
    .setFontColor('#9e9e9e').setFontStyle('italic');

  sheet.setColumnWidths(1, 1, 160); sheet.setColumnWidths(2, 1, 220);
  sheet.setColumnWidths(3, 1, 150); sheet.setColumnWidths(4, 1, 140);
  sheet.setFrozenRows(1);

  ss.setActiveSheet(sheet);
  ui.alert('✅ Created', '"' + tabName + '" tab created!\nDelete the example row and add your agents.', ui.ButtonSet.OK);
}


function showMyAgentProfile() {
  var ui    = SpreadsheetApp.getUi();
  var email = Session.getActiveUser().getEmail();
  var agent = getAgentByEmail(email);

  if (agent) {
    ui.alert('👤 My Agent Profile',
      'Name:        ' + agent.name +
      '\nEmail:       ' + agent.email +
      '\nSmartflo ID: ' + agent.phone +
      '\nTeam:        ' + (agent.team || '—') +
      '\n\nMake sure softphone is logged in & VPN active.',
      ui.ButtonSet.OK);
  } else {
    ui.alert('Not Found',
      'Your email (' + email + ') is not in "' + CRM.SHEETS.AGENT_CONFIG + '".\nAsk admin to add you.',
      ui.ButtonSet.OK);
  }
}


// ── Private helpers ────────────────────────────────────────────

function _callSmartfloC2C(agentNumber, destinationNumber) {
  var token = CRM.PROPS.SMARTFLO_C2C_TOKEN;
  if (!token) throw new Error('Smartflo token not set. Use Admin → Smartflo Token Setup.');

  var dest = '91' + destinationNumber;
  var payload = { async: 1, agent_number: agentNumber, destination_number: dest };

  console.log('[C2C] agent: ' + agentNumber + ' → lead: ' + dest);

  var resp = UrlFetchApp.fetch(CRM.SMARTFLO.BASE_URL + CRM.SMARTFLO.ENDPOINT_C2C, {
    method: 'POST', contentType: 'application/json',
    headers: { 'Authorization': token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  var code = resp.getResponseCode();
  var body = resp.getContentText();
  console.log('[C2C] HTTP ' + code + ': ' + body);

  if (code !== 200) throw new Error('Smartflo API error ' + code + ': ' + body);
  var parsed = JSON.parse(body);
  if (parsed.status === false || parsed.result === 'fail')
    throw new Error('Smartflo rejected: ' + (parsed.message || body));

  return parsed;
}

function _logCallToRow(sheet, rowIndex, agentName, agentPhone) {
  try {
    var C     = CRM.COL;
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yy HH:mm');
    var entry = '📞 ' + stamp + ' — ' + agentName + ' (' + agentPhone + ')';

    var cell    = sheet.getRange(rowIndex, C.ACTION + 1);
    var current = (cell.getValue() || '').toString().trim();
    cell.setValue(current ? current + '\n' + entry : entry).setWrap(true);

    // Auto-bump Lead → Follow-up
    var statusCell = sheet.getRange(rowIndex, C.STATUS + 1);
    if ((statusCell.getValue() || '').toString() === CRM.DEFAULTS.STATUS) {
      statusCell.setValue('Follow-up');
    }
  } catch (e) {
    console.error('_logCallToRow: ' + e.message);
  }
}
