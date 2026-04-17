// ============================================================
//  Main.gs — onOpen() and menu creation
//  Single "CRM Add-Ons" menu with nested submenus.
//  Do NOT define onOpen() in any other .gs file.
// ============================================================

function onOpen() {
  var configCheck = validateConfig();
  if (!configCheck.isValid) {
    showWarning('Configuration Required', configCheck.message);
  }

  var ui = SpreadsheetApp.getUi();
  var role = CRM.CONTEXT.ROLE;

  if (role === 'sales_review') {
    // Sales Review: minimal menu — just sync and admin
    ui.createMenu('🚀 CRM Add-Ons')
      .addItem('💬 WhatsApp Chat',           'openChatSidebar')
      .addSeparator()
      .addSubMenu(ui.createMenu('⚡ Firestore Sync')
        .addItem('▶️ Setup Realtime Sync',    'setupSyncTrigger')
        .addItem('⏹️ Remove Realtime Sync',   'removeSyncTrigger')
        .addSeparator()
        .addItem('📡 Sync Status',            'checkSyncTriggerStatus')
        .addItem('📬 View Pending Syncs',     'viewPendingSyncs')
        .addItem('🔄 Retry Failed Syncs Now', 'processPendingSyncs')
        .addSeparator()
        .addItem('🗑️ Clear Pending Queue',    'clearDeadLetterQueue'))
      .addSubMenu(ui.createMenu('⚙️ Admin')
        .addItem('🔐 Authorize Script', 'authorizeScript')
        .addItem('👤 My Agent Profile',        'showMyAgentProfile')
        .addItem('📋 Setup Agent Config Tab',  'setupAgentConfigSheet')
        .addSeparator()
        .addItem('✓ Check Configuration',      'checkConfig'))
      .addToUi();

  } else {
    // Agents DSR (default): full menu
    ui.createMenu('🚀 CRM Add-Ons')
      .addItem('➕ Add Manual Inquiry',      'openInquiryForm')
      .addSeparator()
      .addItem('💬 WhatsApp Chat',           'openChatSidebar')
      .addItem('☎️  Call Selected Lead',      'openCallSidebar')
      .addItem('📊 Recent Call Log',          'openCallLog')
      .addSeparator()
      .addSubMenu(ui.createMenu('🔥 Firebase Whitelist')
        .addItem('➕ Add Single Number',      'addSingleToWhitelist')
        .addItem('📤 Sync All Numbers',       'syncAllToFirebase')
        .addSeparator()
        .addItem('🔍 Check Status',           'checkSyncStatus')
        .addItem('⚙️ Setup Credentials',      'setupCredentials'))
      .addSubMenu(ui.createMenu('⚡ Firestore Sync')
        .addItem('▶️ Setup Realtime Sync',    'setupSyncTrigger')
        .addItem('⏹️ Remove Realtime Sync',   'removeSyncTrigger')
        .addSeparator()
        .addItem('📡 Sync Status',            'checkSyncTriggerStatus')
        .addItem('📬 View Pending Syncs',     'viewPendingSyncs')
        .addItem('🔄 Retry Failed Syncs Now', 'processPendingSyncs')
        .addSeparator()
        .addItem('🗑️ Clear Pending Queue',    'clearDeadLetterQueue'))
      .addSubMenu(ui.createMenu('⚙️ Admin')
        .addItem('🔐 Authorize Script', 'authorizeScript')
        .addItem('👤 My Agent Profile',        'showMyAgentProfile')
        .addItem('🔑 Smartflo Token Setup',    'openAdminSetup')
        .addItem('📋 Setup Agent Config Tab',  'setupAgentConfigSheet')
        .addSeparator()
        .addItem('✓ Check Configuration',      'checkConfig'))
      .addToUi();
  }
}


/**
 * Manual configuration check for Admin menu
 */
function checkConfig() {
  var config = validateConfig();
  if (config.isValid) {
    showSuccess('Configuration Valid', 'All required settings are configured.');
  } else {
    showError('Configuration Missing', config.message);
  }
}