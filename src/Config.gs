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
  SMARTFLO_C2C_TOKEN:     'SMARTFLO_TOKEN',
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

// Add remaining CRM properties
CRM.SHEETS = {
  DSR:          'Sheet5',
  AGENT_CONFIG: 'Agent_Config',
};

CRM.HEADER_ROW = 1;

// ── DSR Column Indices (0-based) ──────────────────────────────
//
//  A  CGILN       H  PRODUCT     O  REMARK      V  NO_91
//  B  DATE        I  MESSAGE     P  TEAM_2      W  DAY
//  C  TIME        J  SOURCE      Q  STATUS_2    X  HOURS
//  D  NAME        K  TEAM        R  REMARK_2    Y  CONVERTED
//  E  NUMBER      L  STATUS      S  CONF_CB     Z  ATTENDANCE
//  F  REGI_NO     M  RATING      T  CONFIRM     AA INTERACTION
//  G  LOCATION    N  ACTION      U  JOIN_POLL
//
CRM.COL = {
  CGILN:       0,
  DATE:        1,
  TIME:        2,
  NAME:        3,
  NUMBER:      4,
  REGI_NO:     5,
  LOCATION:    6,
  PRODUCT:     7,
  MESSAGE:     8,
  SOURCE:      9,
  TEAM:       10,
  STATUS:     11,
  RATING:     12,
  ACTION:     13,
  REMARK:     14,
  TEAM_2:     15,
  STATUS_2:   16,
  REMARK_2:   17,
  CONF_CB:    18,
  CONFIRM:    19,
  JOIN_POLL:  20,
  NO_91:      21,
  DAY:        22,
  HOURS:      23,
  CONVERTED:  24,
  ATTENDANCE: 25,
  INTERACTION:26,
};

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

CRM.PRODUCTS = ['CGI', 'CV Reports', 'CK Software', 'Consulting', 'Remedies'];

CRM.SOURCES = [
  'Google', 'Just Dial', 'Pilot', 'Refrence', 'Direct',
  'APP Download', 'Old Data', 'Other', 'Book fair',
];

CRM.STATUSES = [
  'Lead', 'Follow-up', 'Interested', 'Not Interested',
  'Converted', 'MC Online Batch', 'MC Offline Batch',
];

// ── Firestore Sync (onEdit trigger) ──────────────────────────
//    TRACKED_COLS: 1-indexed column → field name (what gets synced)
//    HISTORY_ACTIONS: field → Firestore history action label
// ── Firestore Sync (onEdit trigger) ──────────────────────────
CRM.SYNC = (function() {
  
  // ── Master config: 0-based column indices ──
  var fieldConfig = {
    [CRM.COL.NAME]: {
      fieldName: 'name',
      historyAction: 'name_updated'
    },
    [CRM.COL.LOCATION]: {
      fieldName: 'location',
      historyAction: 'location_updated'
    },
    [CRM.COL.TEAM]: {
      fieldName: 'team',
      historyAction: 'claimed'
    },
    [CRM.COL.STATUS]: {
      fieldName: 'status',
      historyAction: 'status_changed'
    },
    [CRM.COL.RATING]: {
      fieldName: 'rating',
      historyAction: 'rating_changed'
    },
    [CRM.COL.REMARK]: {
      fieldName: 'remark',
      historyAction: 'remark_added'
    },
    [CRM.COL.TEAM_2]: {
      fieldName: 'team_2',
      historyAction: 'team_2_changed'
    },
    [CRM.COL.STATUS_2]: {
      fieldName: 'status_2',
      historyAction: 'status_2_changed'
    },
    [CRM.COL.REMARK_2]: {
      fieldName: 'remark_2',
      historyAction: 'remark_2_added'
    },
  };

  var trackedCols = {};
  var historyActions = {};

  // ── Auto-generate TRACKED_COLS & HISTORY_ACTIONS from FIELD_CONFIG ──
  Object.keys(fieldConfig).forEach(function(colNum) {
    var config = fieldConfig[colNum];

    trackedCols[parseInt(colNum) + 1] = config.fieldName;
    historyActions[config.fieldName] = config.historyAction;
  });

  return {
    FIELD_CONFIG: fieldConfig,
    TRACKED_COLS: trackedCols,
    HISTORY_ACTIONS: historyActions
  };

})();

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
  STATUS:  'Lead',
  PRODUCT: 'CGI',
  TEAM:    'Not Assigned',
};


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