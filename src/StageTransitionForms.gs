// ============================================================================
//  StageTransitionForms.gs — Form-gated stage transitions
//
//  When an agent tries to push a lead to sales_review, onSheetEditSync
//  reverts the cell and calls _openSalesReviewForm to collect payment
//  evidence. The actual stage_transition event is sent to the CF only
//  if the agent submits valid form data.
// ============================================================================


/**
 * Open the Sales Review submission form as a modal dialog.
 * Called from SyncToFirestore.onSheetEditSync when an agent
 * sets Pipeline Stage to 'sales_review'.
 *
 * @param {Object} context — { phone, row, oldStage, editor }
 */
function _openSalesReviewForm(context) {
  var tpl = HtmlService.createTemplateFromFile('SalesReviewForm');
  tpl.phone         = context.phone;
  tpl.row           = context.row;
  tpl.oldStage      = context.oldStage;
  tpl.editor        = context.editor;
  tpl.spreadsheetId = CRM.SPREADSHEET_ID;
  tpl.tabName       = CRM.SHEETS.DSR;
  tpl.role          = CRM.CONTEXT.ROLE;

  var html = tpl.evaluate()
    .setWidth(480)
    .setHeight(420);
  SpreadsheetApp.getUi().showModalDialog(html, '📋 Submit to Sales Review');
}


/**
 * Form submission handler. Called from SalesReviewForm.html via
 * google.script.run. Validates form data and forwards a
 * stage_transition event to the Cloud Function.
 *
 * @param {Object} formData — values from the HTML form
 * @returns {Object} { success: boolean, message?: string }
 */
function submitSalesReviewTransition(formData) {
  try {
    if (!formData.phone) {
      return { success: false, message: 'Missing phone number' };
    }
    if (!formData.amountPaid || Number(formData.amountPaid) <= 0) {
      return { success: false, message: 'Amount paid must be greater than 0' };
    }
    if (!formData.modeOfPay) {
      return { success: false, message: 'Select mode of payment' };
    }

    var cfUrl = CRM.PROPS.CLOUD_FUNCTION_URL;
    if (!cfUrl) {
      return { success: false, message: 'Cloud Function URL not configured' };
    }

    var payload = {
      eventType:           'stage_transition',
      phone:               formData.phone,
      oldStage:            formData.oldStage || 'agent_working',
      newStage:            'sales_review',
      sourceRow:           Number(formData.row),
      sourceSpreadsheetId: formData.spreadsheetId || CRM.SPREADSHEET_ID,
      sourceTabName:       formData.tabName       || CRM.SHEETS.DSR,
      sourceRole:          formData.role          || CRM.CONTEXT.ROLE,
      editor:              formData.editor,
      timestamp:           new Date().getTime(),
      formData: {
        amountPaid:     Number(formData.amountPaid),
        modeOfPay:      formData.modeOfPay,
        paymentRefId:   (formData.paymentRefId || '').trim(),
        scholarship:    Number(formData.scholarship || 0),
        installment:    (formData.installment === true || formData.installment === 'true') ? 2 : 1,
        requestDetails: (formData.requestDetails || '').trim(),
      },
    };

    var resp = UrlFetchApp.fetch(cfUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    var code = resp.getResponseCode();
    var body = {};
    try { body = JSON.parse(resp.getContentText()); } catch (e) {}

    if (code === 200 && body.success !== false) {
      return { success: true, message: 'Lead submitted to Sales Review' };
    }

    var reason = body.reason || body.message || ('HTTP ' + code);
    return { success: false, message: 'Transition failed: ' + reason };

  } catch (e) {
    return { success: false, message: 'Error: ' + e.toString() };
  }
}


/**
 * Open the Payment transition form as a modal dialog.
 * Called from SyncToFirestore.onSheetEditSync after the sales-review→payment
 * pre-gates pass (Sales Approval = Approved + all required fields filled).
 *
 * Reads productPrice and scholarship from the row to pre-fill Final Price.
 * Pre-fill is best-effort: stale if the user edits productPrice/scholarship
 * between form open and submit (acceptable — sales confirms the number).
 *
 * @param {Object} context — { phone, row, oldStage, editor }
 */
function _openPaymentTransitionForm(context) {
  // Resolve the active sales_review tab. Mirrors the role-aware logic in
  // onSheetEditSync so the form opens against the correct sheet regardless
  // of whether document properties are set.
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tabName = CRM.SHEETS.DSR;
  if (CRM.CONTEXT && CRM.CONTEXT.ROLE === 'sales_review') {
    tabName = CRM.CONTEXT.TAB_NAME || 'Sheet1';
  }

  var salesSheet = ss.getSheetByName(tabName);
  if (!salesSheet) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Cannot open Payment form: tab "' + tabName + '" not found.',
      '⚠️ Form Error', 5
    );
    return;
  }

  var lastCol = salesSheet.getLastColumn();
  var headerRow = salesSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var rowData = salesSheet.getRange(context.row, 1, 1, lastCol).getValues()[0];

  // Build field key → col index map for the lookups below
  var M = {};
  for (var i = 0; i < headerRow.length; i++) {
    var h = (headerRow[i] || '').toString().trim();
    var fk = CRM.HEADER_TO_FIELD[h];
    if (fk) M[fk] = i;
  }

  // Pre-fill: productPrice − scholarship. Blank if productPrice is missing.
  // (scholarship defaults to 0 if missing, matching standard "no scholarship".)
  var productPrice = M.productPrice !== undefined ? Number(rowData[M.productPrice]) || 0 : 0;
  var scholarship  = M.scholarship  !== undefined ? Number(rowData[M.scholarship])  || 0 : 0;
  var prefilledFee = productPrice > 0 ? (productPrice - scholarship) : '';

  var tpl = HtmlService.createTemplateFromFile('PaymentTransitionForm');
  tpl.phone         = context.phone;
  tpl.row           = context.row;
  tpl.oldStage      = context.oldStage;
  tpl.editor        = context.editor;
  tpl.spreadsheetId = ss.getId();
  tpl.tabName       = tabName;
  tpl.role          = (CRM.CONTEXT && CRM.CONTEXT.ROLE) || '';
  tpl.prefilledFee  = prefilledFee;

  var html = tpl.evaluate().setWidth(480).setHeight(420);
  SpreadsheetApp.getUi().showModalDialog(html, '💰 Submit to Payment');
}


/**
 * Form submission handler. Called from PaymentTransitionForm.html via
 * google.script.run. Validates and forwards a stage_transition event
 * with formData (finalPrice, partialAccess, accessThreshold, paymentDeadline)
 * to the Cloud Function.
 *
 * @param {Object} formData — values from the HTML form
 * @returns {Object} { success: boolean, message?: string }
 */
function submitPaymentTransition(formData) {
  try {
    if (!formData.phone) {
      return { success: false, message: 'Missing phone number' };
    }
    if (!formData.finalPrice || Number(formData.finalPrice) <= 0) {
      return { success: false, message: 'Final price must be greater than 0' };
    }

    var isPartialAccess = formData.partialAccess === true ||
                          formData.partialAccess === 'true';

    if (isPartialAccess) {
      if (!formData.accessThreshold || Number(formData.accessThreshold) <= 0) {
        return { success: false, message: 'Access threshold must be greater than 0' };
      }
      if (Number(formData.accessThreshold) >= Number(formData.finalPrice)) {
        return { success: false, message: 'Access threshold must be less than final price' };
      }
      if (!formData.paymentDeadline) {
        return { success: false, message: 'Deadline date is required for partial access' };
      }
    }

    var cfUrl = CRM.PROPS.CLOUD_FUNCTION_URL;
    if (!cfUrl) {
      return { success: false, message: 'Cloud Function URL not configured' };
    }

    var payload = {
      eventType:           'stage_transition',
      phone:               formData.phone,
      oldStage:            formData.oldStage || 'sales_review',
      newStage:            'payment',
      sourceRow:           Number(formData.row),
      sourceSpreadsheetId: formData.spreadsheetId || CRM.SPREADSHEET_ID,
      sourceTabName:       formData.tabName       || CRM.SHEETS.DSR,
      sourceRole:          formData.role          || (CRM.CONTEXT && CRM.CONTEXT.ROLE) || '',
      editor:              formData.editor,
      timestamp:           new Date().getTime(),
      formData: {
        finalPrice:      Number(formData.finalPrice),
        partialAccess:   isPartialAccess,
        accessThreshold: isPartialAccess ? Number(formData.accessThreshold) : null,
        paymentDeadline: isPartialAccess ? formData.paymentDeadline : null,
      },
    };

    var resp = UrlFetchApp.fetch(cfUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    var code = resp.getResponseCode();
    var body = {};
    try { body = JSON.parse(resp.getContentText()); } catch (e) {}

    if (code === 200 && body.success !== false) {
      return { success: true, message: 'Lead moved to Payment' };
    }

    var reason = body.reason || body.message || ('HTTP ' + code);
    return { success: false, message: 'Transition failed: ' + reason };

  } catch (e) {
    return { success: false, message: 'Error: ' + e.toString() };
  }
}
