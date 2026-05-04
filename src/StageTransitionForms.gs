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
