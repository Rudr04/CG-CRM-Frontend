// ============================================================================
//  CallbackPoller.gs — Desktop alert layer for due callbacks
//  Sidebar polls every 30s; when a callback is due within 5 min,
//  triggers a center-screen modal with alert sound + Smartflo Call button.
//
//  HTML templates: CallbackSidebar.html (sidebar), CallbackAlert.html (modal)
// ============================================================================


function openCallbackPoller() {
  var html = HtmlService.createHtmlOutputFromFile('CallbackSidebar')
    .setTitle('🔔 Callback Monitor');
  SpreadsheetApp.getUi().showSidebar(html);
}


/**
 * Returns rows whose callback is due in the next 5 minutes for the current agent.
 * Called by CallbackSidebar.html every 30s via google.script.run.
 * @returns {Array<Object>} [{ row, cgid, name, number, remark, cbTime }, ...]
 */
function getDueCallbacks() {
  var email = Session.getActiveUser().getEmail();
  var agent = getAgentByEmail(email);
  if (!agent || !agent.name) return [];

  var sheet = getSheet(CRM.SHEETS.DSR);
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var lastCol = sheet.getLastColumn();
  var M = getColumnMap(sheet);

  if (M.team === undefined || M.cbDate === undefined ||
      M.cbTime === undefined || M.calEventId === undefined) {
    return [];
  }

  var rows = lastRow - 1;
  var range = sheet.getRange(2, 1, rows, lastCol);
  var rawData     = range.getValues();
  var displayData = range.getDisplayValues();

  var now    = new Date();
  var window = new Date(now.getTime() + 5 * 60 * 1000);

  var due = [];

  for (var i = 0; i < rawData.length; i++) {
    var raw = rawData[i];
    var dsp = displayData[i];

    var rowAgent = (raw[M.team] || '').toString().trim();
    if (rowAgent !== agent.name) continue;

    var calEventId = (raw[M.calEventId] || '').toString().trim();
    if (!calEventId) continue;

    var cbDate = raw[M.cbDate];
    var cbTime = raw[M.cbTime];
    if (!(cbDate instanceof Date) || !(cbTime instanceof Date)) continue;

    var due_at = new Date(
      cbDate.getFullYear(), cbDate.getMonth(), cbDate.getDate(),
      cbTime.getHours(), cbTime.getMinutes(), 0, 0
    );

    if (due_at < now || due_at > window) continue;

    due.push({
      row:    i + 2,
      cgid:   (M.cgid   !== undefined) ? (dsp[M.cgid]   || '').toString() : '',
      name:   (M.name   !== undefined) ? (dsp[M.name]   || '').toString() : '',
      number: (M.number !== undefined) ? (dsp[M.number] || '').toString() : '',
      remark: (M.remark !== undefined) ? (dsp[M.remark] || '').toString() : '',
      cbTime: (dsp[M.cbTime] || '').toString(),
    });
  }

  return due;
}


/**
 * Opens the center-screen modal alert for a single due callback.
 * Called by CallbackSidebar.html when poll detects a new due row.
 * @param {number} rowIndex 1-based row number
 */
function openCallbackAlert(rowIndex) {
  var sheet = getSheet(CRM.SHEETS.DSR);
  if (!sheet) return;

  var M = getColumnMap(sheet);
  var lastCol = sheet.getLastColumn();
  var dsp = sheet.getRange(rowIndex, 1, 1, lastCol).getDisplayValues()[0];

  function val(key) {
    return (M[key] !== undefined) ? (dsp[M[key]] || '').toString() : '';
  }

  var tpl = HtmlService.createTemplateFromFile('CallbackAlert');
  tpl.lead = {
    row:    rowIndex,
    cgid:   val('cgid'),
    name:   val('name'),
    number: val('number'),
    remark: val('remark'),
    cbTime: val('cbTime'),
  };

  SpreadsheetApp.getUi().showModalDialog(
    tpl.evaluate().setWidth(420).setHeight(350),
    '🔔 Callback Due!'
  );
}
