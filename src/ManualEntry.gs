/** ============================================================================
//  InquiryForm.gs — Manual Inquiry Form (server-side)
//  HTML lives in InquiryForm.html (loaded via createTemplateFromFile)
// ============================================================================*/

/** Open the inquiry form modal — called from menu */
function openInquiryForm() {
  var html = HtmlService.createTemplateFromFile('InquiryForm')
    .evaluate()
    .setWidth(800)
    .setHeight(820);
  SpreadsheetApp.getUi().showModalDialog(html, '➕ Add Manual Inquiry');
}

/** Called by form HTML to populate dropdowns */
function getDropdownOptions() {
  return {
    agents:    CRM.AGENTS,
    inquiries: CRM.INQUIRIES,
    products:  CRM.PRODUCTS,
    sources:   CRM.SOURCES,
  };
}

/** Called by form HTML on submit */
function submitInquiry(formData) {
  try {
    var errors = _validateInquiry(formData);
    if (errors.length > 0) return { success: false, message: errors[0] };

    // Clean phone number: remove + prefix for waId but keep for display
    var waId = formData.phone.replace(/^\+/, '');

    var payload = {
      eventType:  'Manually_Entry',
      senderName: formData.name,
      waId:       waId,
      email:      formData.email || '',
      location:   formData.state || '',
      inquiry:    formData.inquiry || CRM.DEFAULTS.INQUIRY,
      product:    formData.product || '',
      source:     formData.source,
      team:       formData.agent,
      remark:     formData.remarks || '',
      timestamp:  new Date().getTime(),
    };

    var result = _sendToCloudFunction(payload);
    return result.success
      ? { success: true, message: 'Inquiry added successfully', row: result.row }
      : { success: false, message: result.message || 'Failed to add inquiry' };

  } catch (error) {
    Logger.log('submitInquiry error: ' + error);
    return { success: false, message: error.toString() };
  }
}


/** ── Private Helpers ────────────────────────────────────────────*/

function _validateInquiry(data) {
  var errors = [];
  
  if (!data.name || !data.name.trim()) {
    errors.push('Name is required');
  }
  
  if (!data.phone || !data.phone.trim()) {
    errors.push('Phone number is required');
  } else {
    // Phone format: +CCNNNNNNN (country code + number)
    // Extract digits only for length check
    var phoneDigits = data.phone.replace(/\D/g, '');
    if (phoneDigits.length < 8 || phoneDigits.length > 15) {
      errors.push('Phone number must be 8-15 digits (including country code)');
    }
    // Check it starts with + (country code prefix)
    if (!data.phone.startsWith('+')) {
      errors.push('Phone must include country code (e.g., +91...)');
    }
  }
  
  if (!data.agent) {
    errors.push('Agent is required');
  }
  
  if (!data.inquiry || !data.inquiry.trim()) {
    errors.push('Select an inquiry type');
  }
  
  if (!data.source) {
    errors.push('Source is required');
  }
  
  return errors;
}

function _sendToCloudFunction(payload) {
  try {
    var url = CRM.PROPS.CLOUD_FUNCTION_URL;
    if (!url) {
      Logger.log('CLOUD_FUNCTION_URL not configured — using sheet fallback');
      return _addInquiryToSheet(payload);
    }

    var resp = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify(payload), muteHttpExceptions: true,
    });
    var body = JSON.parse(resp.getContentText());

    if (resp.getResponseCode() === 200 && body.status === 'success') {
      return { success: true, row: body.row };
    }
    Logger.log('Cloud function error: ' + resp.getContentText());
    return _addInquiryToSheet(payload);  // fallback
  } catch (error) {
    Logger.log('Cloud function fetch error: ' + error);
    return _addInquiryToSheet(payload);  // fallback
  }
}

/** Fallback: write directly to sheet when Cloud Function is unreachable */
function _addInquiryToSheet(payload) {
  try {
    var C = CRM.COL;
    var sheet = getSheet(CRM.SHEETS.DSR);
    var newRow = sheet.getLastRow() + 1;

    var now  = new Date();
    var date = Utilities.formatDate(now, Session.getScriptTimeZone(), 'MM/dd/yyyy');
    var ist  = new Date(now.getTime() + 5.5 * 3600000);
    var time = [ist.getHours(), ist.getMinutes(), ist.getSeconds()]
      .map(function(n) { return String(n).padStart(2, '0'); }).join(':');

    var row = new Array(C.PIPELINE_STAGE + 1).fill('');
    row[C.CGID]       = '=ROW()-1+' + CRM.SERIAL_OFFSET;
    row[C.DATE]       = date;
    row[C.TIME]       = time;
    row[C.NAME]       = payload.senderName;
    row[C.NUMBER]     = payload.waId;
    row[C.LOCATION]   = payload.location;
    row[C.INQUIRY]    = payload.inquiry || CRM.DEFAULTS.INQUIRY;
    row[C.PRODUCT]    = payload.product || '';
    row[C.SOURCE]     = payload.source;
    row[C.TEAM]       = payload.team;
    row[C.STATUS]     = CRM.DEFAULTS.STATUS;
    row[C.REMARK]     = payload.remark;
    row[C.DAY]        = '=IFERROR(WEEKDAY($' + CRM.COL_LETTER.DATE + newRow + ',2)&TEXT($' + CRM.COL_LETTER.DATE + newRow + ',"dddd"), "")';
    row[C.HOURS]      = '=IFERROR(HOUR($' + CRM.COL_LETTER.TIME + newRow + '), "")';
    row[C.CONVERTED]  = '=SWITCH(' + CRM.COL_LETTER.STATUS + newRow + ',"Admission Done",1,"Seat Booked",1,0)';

    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return { success: true, row: newRow };
  } catch (error) {
    Logger.log('Sheet fallback error: ' + error);
    return { success: false, message: error.toString() };
  }
}