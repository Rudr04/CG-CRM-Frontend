// ============================================================================
//  Config.gs — Single source of truth for ALL Apps Script constants
//
//  PROPERTY SCHEMA (lines 14-27): Define all Script Properties here
//  - If storage key differs from field name, specify it explicitly
//  - Auto-generates _PROP_MAP and CRM.PROPS from this schema
//
//  USAGE in other files:
//    CRM.PROPS.SMARTFLO_TOKEN  (read values)
//    saveProp('SMARTFLO_TOKEN', newValue)  (write values)
//
//  TO RENAME A PROPERTY: Just edit the schema below — ONE place only!
//    Before: SMARTFLO_TOKEN: 'SMARTFLO_TOKEN'
//    After:  SMARTFLO_C2C_TOKEN: 'SMARTFLO_C2C_TOKEN'
//    All other files automatically use the new name!
// ============================================================================

// ── SINGLE SOURCE OF TRUTH: Property Schema ────────────────────────────────
//    Format: FIELD_NAME: 'storage_key_in_script_properties'
//    If they match, use same name. If different, specify storage key.
// ────────────────────────────────────────────────────────────────────────────
var _PROPERTY_SCHEMA = {
  CLOUD_FUNCTION_URL: 'CLOUD_FUNCTION_URL',
  FIREBASE_URL:       'FIREBASE_DATABASE_URL',  // ← Different storage key
  FIREBASE_SECRET:    'FIREBASE_SECRET',
  SMARTFLO_C2C_TOKEN: 'SMARTFLO_TOKEN',
  WATI_BASE_URL:      'WATI_BASE_URL',
  WATI_BEARER_TOKEN:  'WATI_BEARER_TOKEN',
  WATI_TENANT_ID:     'WATI_TENANT_ID',
};

// ── Auto-generate _PROP_MAP and CRM.PROPS from schema ─────────────────────
var _sp = PropertiesService.getScriptProperties().getProperties();
var _PROP_MAP = {};
var CRM = { PROPS: {} };

// Initialize from schema
Object.keys(_PROPERTY_SCHEMA).forEach(function(fieldName) {
  var storageKey = _PROPERTY_SCHEMA[fieldName];
  _PROP_MAP[fieldName] = storageKey;
  CRM.PROPS[fieldName] = _sp[storageKey] || '';
});

// ── Per-Sheet Context (Document Properties) ──────────────────
// Set per-spreadsheet: CRM_SHEET_ROLE and CRM_SHEET_TAB_NAME
// Roles: 'agents_dsr', 'sales_review', 'payments', 'delivery', 'master'
CRM.CONTEXT = (function() {
  try {
    var dp = PropertiesService.getDocumentProperties().getProperties();
    return {
      ROLE:     dp['CRM_SHEET_ROLE']     || 'agents_dsr',  // default to DSR
      TAB_NAME: dp['CRM_SHEET_TAB_NAME'] || 'Sheet5',
    };
  } catch (err) {
    return { ROLE: 'agents_dsr', TAB_NAME: 'Sheet5' };
  }
})();

// Add remaining CRM properties
CRM.SHEETS = {
  DSR:          CRM.CONTEXT.TAB_NAME || 'Sheet5',
  AGENT_CONFIG: 'Agent_Config',
};

CRM.SPREADSHEET_ID = (function() {
  try {
    return SpreadsheetApp.getActiveSpreadsheet().getId();
  } catch (e) {
    return '';
  }
})();

CRM.HEADER_ROW = 1;

// ── Agent_Config Tab Columns (0-based) ────────────────────────
CRM.AGENT_COL = {
  NAME:     0,
  EMAIL:    1,
  AGENT_ID: 2,
  TEAM:     3,
};

// ── Dropdown Lists ────────────────────────────────────────────
CRM.AGENTS = [
  'Priyanshi', 'Namrata', 'Mahesh', 'Purvi', 'Bhailal Kaka',
  'Shivani', 'Payal', 'ROBO', 'Vidhyuta', 'Manthan',
];

CRM.INQUIRIES = ['CGI', 'CosmoGuru', 'CosmoKundli', 'CosmoWellness'];
CRM.PRODUCTS = ['Jyotish', 'Vastu', 'CV Planner 5D', 'Grah Vibes', 'Cosmo Vibes', 'Consultation'];

CRM.SOURCES = [
  'Google', 'Just Dial', 'Pilot', 'Refrence', 'Direct',
  'APP Download', 'Old Data', 'Other', 'Book fair',
];

CRM.STATUSES = [
  'Lead', 'Follow-Up', 'Interested', 'Not Interested',
  'Converted', 'MC Online Batch', 'MC Offline Batch',
];


// ── External APIs ────────────────────────────────────────────
CRM.SMARTFLO = {
  BASE_URL:     'https://api-smartflo.tatateleservices.com',
  ENDPOINT_C2C: '/v1/click_to_call',
};

// ── Timings ──────────────────────────────────────────────────
CRM.CHAT_POLL_MS = 3000;

// ── Formulas ─────────────────────────────────────────────────
CRM.SERIAL_OFFSET = 230000;

// ── Defaults ─────────────────────────────────────────────────
CRM.DEFAULTS = {
  STATUS:     'Lead',
  INQUIRY:    'CGI',
  TEAM:       'Not Assigned',
  ROBO_AGENT: 'ROBO',
  FOLLOW_UP:  'Follow-Up',
};

// ── Field Headers — Maps field keys to sheet header text ─────
//    Matches CF config.FIELD_HEADERS exactly
//    Used by dynamic column lookup (getColumnMap in Utils.gs)
CRM.FIELD_HEADERS = {
  cgid:          'CGID',
  date:          'Date',
  time:          'Time',
  name:          'Name',
  number:        'Mobile Number',
  location:      'Location',
  inquiry:       'Inquiry',
  product:       'Product',
  message:       'Message',
  source:        'Source',
  team:          'Team',
  status:        'Status',
  rating:        'Rating',
  cbDate:        'CB Date',
  remark:        'Remark',
  day:           'Day',
  hours:         'Hours',
  converted:     'Converted',
  pipelineStage: 'Pipeline Stage',
  scholarship:   'Scholarship',
  installment:   'Installment',
  // Phase 3 fields
  salesRemark:     'Sales Remark',
  approvalDate:    'Approval Date',
  quantity:        'Quantity',
  productPrice:    'Product Price',
  amountPaid:      'Amount Paid',
  pendingAmount:   'Pending Amount',
  modeOfPay:       'Mode of Pay',
  paymentRefId:    'Payment Ref. ID',
  dateOfPayment:   'Date of Payment',
  receivedAccount: 'Received Account',
  paymentRemark:   'Payment Remark',
  fulfillmentStatus: 'Fulfillment Status',
  fulfillmentDate:   'Fulfillment Date',
  fulfillmentRemark: 'Fulfillment Remark',
};

// Reverse map: header text → field key
CRM.HEADER_TO_FIELD = {};
(function() {
  var keys = Object.keys(CRM.FIELD_HEADERS);
  for (var i = 0; i < keys.length; i++) {
    CRM.HEADER_TO_FIELD[CRM.FIELD_HEADERS[keys[i]]] = keys[i];
  }
})();

// ── Firestore Sync (onEdit trigger) ──────────────────────────
//    TRACKED_HEADERS: header text → field key (what gets synced)
//    HISTORY_ACTIONS: field → Firestore history action label
CRM.SYNC = (function() {
  var fieldSyncConfig = {
    name:          { historyAction: 'name_updated' },
    location:      { historyAction: 'location_updated' },
    inquiry:       { historyAction: 'inquiry_changed' },
    product:       { historyAction: 'product_added' },
    team:          { historyAction: 'claimed' },
    status:        { historyAction: 'status_changed' },
    rating:        { historyAction: 'rating_changed' },
    remark:        { historyAction: 'remark_added' },
    pipelineStage: { historyAction: 'stage_changed' },
    // Phase 3
    salesRemark:     { historyAction: 'sales_remark_added' },
    fulfillmentStatus: { historyAction: 'fulfillment_status_changed' },
    fulfillmentRemark: { historyAction: 'fulfillment_remark_added' },
  };

  var trackedHeaders = {};
  var historyActions = {};

  var fieldKeys = Object.keys(fieldSyncConfig);
  for (var i = 0; i < fieldKeys.length; i++) {
    var fieldKey = fieldKeys[i];
    var header = CRM.FIELD_HEADERS[fieldKey];
    if (header) {
      trackedHeaders[header] = fieldKey;
    }
    historyActions[fieldKey] = fieldSyncConfig[fieldKey].historyAction;
  }

  return {
    FIELD_SYNC_CONFIG: fieldSyncConfig,
    TRACKED_HEADERS:   trackedHeaders,
    HISTORY_ACTIONS:   historyActions,
  };
})();


/**
 * Save a property to Script Properties AND update CRM.PROPS in memory.
 * Only used in admin setup flows (Firebase setup, Smartflo token, etc.)
 * @param {string} propName  — CRM.PROPS field name, e.g. 'FIREBASE_URL'
 * @param {string} value     — value to store
 */
function saveProp(propName, value) {
  var storageKey = _PROP_MAP[propName];
  if (!storageKey) throw new Error('Unknown prop: ' + propName);
  PropertiesService.getScriptProperties().setProperty(storageKey, value);
  CRM.PROPS[propName] = value;
}

/**
 * ✅ NEW: Validate configuration — check for required Script Properties
 * Automatically reads from _PROPERTY_SCHEMA — no hardcoded field names!
 * @returns {Object} {isValid: boolean, missingFields: array, message: string}
 */
function validateConfig() {
  var missingFields = [];

  // ✅ Automatically use all properties from schema as required fields
  var requiredFields = Object.keys(_PROPERTY_SCHEMA);

  for (var i = 0; i < requiredFields.length; i++) {
    var field = requiredFields[i];
    if (!CRM.PROPS[field]) {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    return {
      isValid: false,
      missingFields: missingFields,
      message: 'Missing configuration: ' + missingFields.join(', ') +
               '\n\nPlease configure these via CRM Add-Ons > Admin > Setup options.'
    };
  }

  return {
    isValid: true,
    missingFields: [],
    message: 'Configuration is valid'
  };
}