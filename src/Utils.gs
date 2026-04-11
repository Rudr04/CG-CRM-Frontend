// ============================================================================
//  Utils.gs — Shared helpers used by multiple .gs files
//  These are the ONLY copies of these functions — no other file redefines them.
// ============================================================================


// ── Sheet & Property Helpers ───────────────────────────────────

/** Get a sheet by name (returns null if not found) */
function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

/** @deprecated — use CRM.PROPS.X directly for reads, saveProp() for writes */


// ── String Helpers ─────────────────────────────────────────────

/** HTML-escape for building sidebar/dialog HTML server-side */
function escHtml(str) {
  return (str || '').toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}


// ── Phone Helpers ──────────────────────────────────────────────

/** Strip to last 10 digits (for Indian mobiles) */
function cleanPhone(str) {
  return (str || '').toString().replace(/\D/g, '').slice(-10);
}

/**
 * Clean and format phone number with optional format parameter
 * @param {string} phone - Phone number to clean
 * @param {string} format - Format type: 'raw' (default), 'display' (5 5 format)
 * @returns {string} Cleaned phone number
 */
function cleanAndFormatPhone(phone, format) {
  format = format || 'raw';
  var cleaned = cleanPhone(phone);

  if (format === 'display') {
    return formatDisplayNumber(cleaned);
  }
  return cleaned;
}

/** Validate if phone number has minimum 10 digits */
function isValidPhone(phone) {
  return cleanPhone(phone).length === 10;
}

/** Strip spaces/dashes from Smartflo extension ID — keep ALL digits */
function cleanAgentId(str) {
  return (str || '').toString().replace(/[\s\-]/g, '');
}

/** Format for display: 98765 43210 */
function formatDisplayNumber(raw) {
  var d = cleanPhone(raw);
  return d.length === 10 ? d.slice(0, 5) + ' ' + d.slice(5) : raw;
}


// ── Lead Data Reader ───────────────────────────────────────────

/**
 * Read lead data from a row using dynamic header positions.
 * Works on any sheet regardless of column order.
 * @param {Sheet} sheet  The sheet object
 * @param {number} rowIndex  1-based row number
 * @returns {Object|null}  Lead object, or null (with alert) if no phone
 */
function getLeadData(sheet, rowIndex) {
  var M = getColumnMap(sheet);
  var lastCol = sheet.getLastColumn();
  var d = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];

  var number = (M.number !== undefined) ? (d[M.number] || '').toString().trim() : '';

  if (!number) {
    SpreadsheetApp.getUi().alert(
      'No Number', 'Row ' + rowIndex + ' has no phone number.',
      SpreadsheetApp.getUi().ButtonSet.OK);
    return null;
  }

  function val(fieldKey) {
    return (M[fieldKey] !== undefined) ? (d[M[fieldKey]] || '').toString().trim() : '';
  }

  return {
    row:      rowIndex,
    rowIndex: rowIndex,
    cgid:     val('cgid'),
    date:     val('date'),
    time:     val('time'),
    name:     val('name'),
    number:   number,
    location: val('location'),
    inquiry:  val('inquiry'),
    product:  val('product'),
    message:  val('message'),
    source:   val('source'),
    team:     val('team'),
    status:   val('status'),
    rating:   val('rating'),
    cbDate:   val('cbDate'),
    remark:   val('remark'),
    pipelineStage: val('pipelineStage'),
  };
}

/**
 * Read header row and build field key → column index map.
 * @param {Sheet} sheet — the Sheet object
 * @returns {Object} { fieldKey: 0-based-index } e.g. { name: 3, status: 11, ... }
 */
function getColumnMap(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return {};

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var h = (headers[i] || '').toString().trim();
    if (!h) continue;
    var fieldKey = CRM.HEADER_TO_FIELD[h];
    if (fieldKey) map[fieldKey] = i;
  }
  return map;
}


// ── Agent Lookups ──────────────────────────────────────────────

/** Look up agent by Google email from Agent_Config tab */
function getAgentByEmail(email) {
  if (!email) return null;
  var sheet = getSheet(CRM.SHEETS.AGENT_CONFIG);
  if (!sheet) return null;

  var A = CRM.AGENT_COL;
  var rows = Math.max(sheet.getLastRow() - 1, 1);
  var data = sheet.getRange(2, 1, rows, 4).getValues();

  for (var i = 0; i < data.length; i++) {
    var rowEmail = (data[i][A.EMAIL] || '').toString().trim().toLowerCase();
    if (rowEmail === email.toLowerCase()) {
      return {
        name:  (data[i][A.NAME]     || '').toString().trim(),
        email: rowEmail,
        phone: (data[i][A.AGENT_ID] || '').toString().trim(),
        team:  (data[i][A.TEAM]     || '').toString().trim(),
      };
    }
  }
  return null;
}

/** Get all agents from Agent_Config tab */
function getAllAgents() {
  var sheet = getSheet(CRM.SHEETS.AGENT_CONFIG);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var A = CRM.AGENT_COL;
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues()
    .filter(function(row) { return row[A.EMAIL]; })
    .map(function(row) {
      return {
        name:  (row[A.NAME]     || '').toString().trim(),
        email: (row[A.EMAIL]    || '').toString().trim(),
        phone: (row[A.AGENT_ID] || '').toString().trim(),
        team:  (row[A.TEAM]     || '').toString().trim(),
      };
    });
}


// ── Toast Helpers ──────────────────────────────────────────────

function showSuccessToast(message) {
  SpreadsheetApp.getActiveSpreadsheet().toast(message, 'Success', 3);
}

function showErrorToast(message) {
  SpreadsheetApp.getActiveSpreadsheet().toast(message, 'Error', 5);
}

/**
 * Show structured error alert to user with emoji prefix
 * @param {string} title - Error title (e.g., 'Firebase Error')
 * @param {string} message - Error message details
 */
function showError(title, message) {
  var ui = SpreadsheetApp.getUi();
  ui.alert('❌ ' + title, message, ui.ButtonSet.OK);
  showErrorToast(title + ': ' + message);
}

/**
 * Show structured warning alert to user
 * @param {string} title - Warning title
 * @param {string} message - Warning message details
 * @returns {number} Button ID (1 = OK, 0 = Cancel)
 */
function showWarning(title, message) {
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert('⚠️ ' + title, message, ui.ButtonSet.YES_NO);
  return response;
}

/**
 * Show structured success message to user
 * @param {string} title - Success title
 * @param {string} message - Success message details
 */
function showSuccess(title, message) {
  var ui = SpreadsheetApp.getUi();
  ui.alert('✓ ' + title, message, ui.ButtonSet.OK);
  showSuccessToast(title + ': ' + message);
}

/**
 * Forces script authorization for current user.
 * Each user should run this ONCE so their edits are tracked properly.
 */
function authorizeScript() {
  var ui = SpreadsheetApp.getUi();
  var email = Session.getActiveUser().getEmail();
  
  if (email) {
    // Store that this user has authorized
    var userProps = PropertiesService.getUserProperties();
    userProps.setProperty('AUTHORIZED', 'true');
    userProps.setProperty('USER_EMAIL', email);
    
    ui.alert('✅ Authorized!', 
      'Script authorized for: ' + email + '\n\n' +
      'Your edits will now be tracked with your email.',
      ui.ButtonSet.OK);
  } else {
    ui.alert('⚠️ Authorization Issue',
      'Could not get your email. Please try again or contact admin.',
      ui.ButtonSet.OK);
  }
}


// ── HTML Template Include Helper ───────────────────────────────
// Usage in .html:  <?!= include('SharedStyles') ?>

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
