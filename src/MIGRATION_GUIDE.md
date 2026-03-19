# Apps Script Refactoring — Migration Guide

## What Changed

### Before (4 files, scattered config)
```
manual___firebase.gs  → CONFIG object, AGENTS/PRODUCTS/SOURCES, form + Firebase
smartfloCall.gs       → DSR_SHEET, C columns, ACOL, SMARTFLO_BASE, dialer + admin
Watichat.gs           → CHAT_POLL_MS, depends on smartfloCall's constants
Main.gs               → onOpen() with 4 separate menus
```

**Also scattered:** Script Property key strings like `'SMARTFLO_TOKEN'`, `'FIREBASE_SECRET'`,
`'WATI_BASE_URL'` were hardcoded as raw strings in every file that needed them.

### After (7 .gs + 5 .html, single config)
```
Config.gs           → CRM.* — THE single source of truth
                       CRM.PROPS.* — all Script Property key names
Main.gs             → onOpen() — one "🚀 CRM Add-Ons" menu
Utils.gs            → Shared helpers (getProp, setProp, escHtml, cleanPhone, etc.)
InquiryForm.gs      → Manual inquiry server-side logic
FirebaseSync.gs     → Firebase whitelist operations
SyncToFirestore.gs  → Real-time onEdit → Firestore sync (installable trigger)
SmartfloDialer.gs   → Click-to-call, agent config, admin setup
WatiChat.gs         → WhatsApp chat WATI API calls

InquiryForm.html    → Manual inquiry form UI
CallSidebar.html    → Dialer sidebar UI
AdminSetup.html     → Smartflo token setup UI
CallLog.html        → Recent call log UI
ChatSidebar.html    → WhatsApp chat sidebar UI
```

**Script Properties centralized:**  Every key lives in `CRM.PROPS`:
```javascript
CRM.PROPS.CLOUD_FUNCTION_URL  → 'CLOUD_FUNCTION_URL'
CRM.PROPS.FIREBASE_URL        → 'FIREBASE_DATABASE_URL'
CRM.PROPS.FIREBASE_SECRET     → 'FIREBASE_SECRET'
CRM.PROPS.SMARTFLO_TOKEN      → 'SMARTFLO_TOKEN'
CRM.PROPS.WATI_BASE_URL       → 'WATI_BASE_URL'
CRM.PROPS.WATI_BEARER_TOKEN   → 'WATI_BEARER_TOKEN'
CRM.PROPS.WATI_TENANT_ID      → 'WATI_TENANT_ID'
```
Usage: `getProp(CRM.PROPS.SMARTFLO_TOKEN)` — never raw strings.

## Critical Bug Fixed

**Column index mismatch** — The old smartfloCall.gs was missing `MESSAGE` at index 8.
Everything from SOURCE onward was off by 1 compared to what the Cloud Function writes.

| Column | Old smartfloCall.gs | Cloud Function | New (fixed) |
|--------|-------------------|----------------|-------------|
| I (8)  | SOURCE            | **MESSAGE**    | **MESSAGE** |
| J (9)  | TEAM              | SOURCE         | SOURCE      |
| K (10) | STATUS            | TEAM           | TEAM        |
| L (11) | RATING            | STATUS         | STATUS      |
| M (12) | REMARK            | RATING         | RATING      |
| N (13) | ACTION            | ACTION         | ACTION      |

**Impact**: Dialer was reading STATUS from the TEAM column, writing call logs
and status updates to wrong columns. Now aligned with Cloud Function.

## Deployment Steps

### 1. Backup current project
In Apps Script editor → File → Make a copy

### 2. Delete old files
Remove all 4 existing .gs files:
- `manual___firebase.gs`
- `smartfloCall.gs`
- `Watichat.gs`
- `Main.gs`

### 3. Create new files
Create each file in the editor (File → New):

**Script files (.gs)** — create as "Script":
1. `Config` → paste Config.gs
2. `Main` → paste Main.gs
3. `Utils` → paste Utils.gs
4. `InquiryForm` → paste InquiryForm.gs
5. `FirebaseSync` → paste FirebaseSync.gs
6. `SyncToFirestore` → paste SyncToFirestore.gs
7. `SmartfloDialer` → paste SmartfloDialer.gs
8. `WatiChat` → paste WatiChat.gs

**HTML files** — create as "HTML" (File → New → HTML file):
1. `InquiryForm` → paste InquiryForm.html
2. `CallSidebar` → paste CallSidebar.html
3. `AdminSetup` → paste AdminSetup.html
4. `CallLog` → paste CallLog.html
5. `ChatSidebar` → paste ChatSidebar.html

### 4. Verify Script Properties
These must still be set (Gear icon → Script Properties):
- `CLOUD_FUNCTION_URL`
- `FIREBASE_DATABASE_URL`
- `FIREBASE_SECRET`
- `SMARTFLO_TOKEN`
- `WATI_BASE_URL`
- `WATI_BEARER_TOKEN`
- `WATI_TENANT_ID`

### 5. Save and reload spreadsheet
- Save all files in the editor
- Reload the spreadsheet
- You should see one menu: **🚀 CRM Add-Ons**

### 6. Test each feature
- [ ] Add Manual Inquiry → form opens, submits
- [ ] WhatsApp Chat → sidebar loads, messages poll
- [ ] Call Selected Lead → dialer sidebar, C2C works
- [ ] Firebase → sync, add single, check status
- [ ] Firestore Sync → setup trigger, edit a tracked column, verify CF receives it
- [ ] Admin → Smartflo setup, agent profile, config tab

### 7. Re-install Firestore sync trigger
The old `onSheetEditSync` trigger pointed to old code. After deployment:
1. Go to **Extensions → Apps Script → Triggers** (clock icon)
2. Delete any existing `onSheetEditSync` trigger
3. Use menu: **CRM Add-Ons → Firebase → ⚡ Setup Realtime Sync**

## Menu Structure (New)
```
🚀 CRM Add-Ons
├── ➕ Add Manual Inquiry
├── ─────────────────
├── 💬 WhatsApp Chat
├── ☎️  Call Selected Lead
├── 📊 Recent Call Log
├── ─────────────────
├── 🔥 Firebase Whitelist ►
│   ├── ➕ Add Single Number
│   ├── 📤 Sync All Numbers
│   ├── ──────────────
│   ├── ⚡ Setup Realtime Sync
│   ├── ❌ Remove Realtime Sync
│   ├── 📡 Sync Trigger Status
│   ├── ──────────────
│   ├── 🔍 Check Status
│   └── ⚙️ Setup Credentials
└── ⚙️ Admin ►
    ├── 👤 My Agent Profile
    ├── 🔑 Smartflo Token Setup
    └── 📋 Setup Agent Config Tab
```

## Verify Column Fix
After deployment, test by:
1. Add a new lead via Cloud Function (webhook)
2. Select that row → open Call Sidebar
3. Verify the sidebar shows correct STATUS, TEAM, PRODUCT values
4. Make a test call → verify call log writes to column N (ACTION)
5. Verify status auto-bumps from "Lead" to "Follow-up" in column L (STATUS)
