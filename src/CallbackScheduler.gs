// ============================================================================
//  CallbackScheduler.gs — Google Calendar callback reminders
//
//  When agent sets both CB Date + CB Time on a lead row:
//  → Creates a Google Calendar event on the editing agent's own calendar
//  → Agent gets popup notification on all devices (10 min before)
//  → Tapping the notification link opens the sheet row
//
//  Works because each agent has their own installable onEdit trigger
//  with triggerOwner === activeUser guard. CalendarApp.getDefaultCalendar()
//  runs under the editing agent's OAuth context = their personal calendar.
//
//  Event IDs stored in the "Cal Event ID" sheet column (calEventId field)
//  so the correct event can be updated/deleted on reschedule or clear.
// ============================================================================


// ─────────────────────────────────────────────────────────────
//  Parse a sheet date value + time string into a JS Date in IST
//  cbDateVal: Date object OR ISO/locale string from the sheet cell
//  cbTimeVal: human time like "2:30 PM" (one of CRM.CB_TIMES)
// ─────────────────────────────────────────────────────────────
function _parseCallbackDateTime(cbDateVal, cbTimeVal) {
  // cbDateVal is a display string like "09/05/26" (DD/MM/YY)
  // Do NOT use new Date(cbDateVal) — it assumes MM/DD
  var dateParts = cbDateVal.toString().trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!dateParts) {
    throw new Error('Invalid CB Date format: ' + cbDateVal + ' (expected DD/MM/YY)');
  }
  var day   = parseInt(dateParts[1], 10);
  var month = parseInt(dateParts[2], 10) - 1;
  var year  = parseInt(dateParts[3], 10);
  if (year < 100) year += 2000;

  // cbTimeVal is a display string like "2:30 PM"
  var m = (cbTimeVal || '').toString().trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) {
    throw new Error('Invalid CB Time format: ' + cbTimeVal);
  }
  var hours   = parseInt(m[1], 10);
  var minutes = parseInt(m[2], 10);
  var meridiem = m[3].toUpperCase();
  if (meridiem === 'PM' && hours !== 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;

  // Build ISO string with IST offset so the Date is the exact
  // wall-clock moment in Kolkata, regardless of script runtime TZ
  var pad = function(n) { return (n < 10 ? '0' : '') + n; };
  var iso = year + '-' + pad(month + 1) + '-' + pad(day) +
            'T' + pad(hours) + ':' + pad(minutes) + ':00+05:30';
  var dt = new Date(iso);
  if (isNaN(dt.getTime())) {
    throw new Error('Failed to build IST datetime from: ' + iso);
  }
  return dt;
}

// ─────────────────────────────────────────────────────────────
//  scheduleCallback — create a Calendar event on the editor's calendar
// ─────────────────────────────────────────────────────────────
function scheduleCallback(sheet, row) {
  var M = getColumnMap(sheet);
  var lastCol = sheet.getLastColumn();
  var rowVals = sheet.getRange(row, 1, 1, lastCol).getDisplayValues()[0];

  function val(fieldKey) {
    return (M[fieldKey] !== undefined) ? rowVals[M[fieldKey]] : '';
  }

  var cgid   = (val('cgid') || '').toString().trim();
  var name   = (val('name') || '').toString().trim() || 'Lead';
  var number = (val('number') || '').toString().trim();

  // Read date/time as raw Date objects — no string parsing needed
  var cbDateObj = (M.cbDate !== undefined) ? sheet.getRange(row, M.cbDate + 1).getValue() : null;
  var cbTimeObj = (M.cbTime !== undefined) ? sheet.getRange(row, M.cbTime + 1).getValue() : null;

  if (!cbDateObj || !cbTimeObj) {
    console.warn('[Callback] scheduleCallback called without both cbDate and cbTime — skipping');
    return;
  }

  var startTime = new Date(cbDateObj);
  startTime.setHours(cbTimeObj.getHours(), cbTimeObj.getMinutes(), 0, 0);
  var endTime = new Date(startTime.getTime() + 15 * 60 * 1000);

  var last4 = number ? number.slice(-4) : '';
  var title = '📞 Callback: ' + name + (last4 ? ' (' + last4 + ')' : '');

  var sheetUrl = '';
  try {
    sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
  } catch (urlErr) {
    sheetUrl = '';
  }

  var description =
    'Callback scheduled for lead:\n' +
    'Name: ' + name + '\n' +
    'Phone: ' + number + '\n' +
    'CGID: ' + cgid + '\n' +
    (sheetUrl ? '\nOpen sheet: ' + sheetUrl : '');

  var calendar = CalendarApp.getDefaultCalendar();
  var event = calendar.createEvent(title, startTime, endTime, {
    description: description,
    location: number,
  });
  event.addPopupReminder(10);

  if (M.calEventId !== undefined) {
    sheet.getRange(row, M.calEventId + 1).setValue(event.getId());
  }

  console.log('[Callback] Created event for ' + cgid + ' at ' + startTime);
}

// ─────────────────────────────────────────────────────────────
//  cancelCallback — delete the existing event, clear stored ID
// ─────────────────────────────────────────────────────────────
function cancelCallback(sheet, row) {
  var M = getColumnMap(sheet);
  if (M.calEventId === undefined) return;

  var eventId = (sheet.getRange(row, M.calEventId + 1).getValue() || '').toString().trim();
  if (!eventId) return;

  try {
    var calendar = CalendarApp.getDefaultCalendar();
    var event = calendar.getEventById(eventId);
    if (event) {
      event.deleteEvent();
    }
  } catch (delErr) {
    // Event may have been deleted manually in Calendar — fall through and clear cell
    console.warn('[Callback] Could not delete event ' + eventId + ': ' + delErr.message);
  }

  sheet.getRange(row, M.calEventId + 1).setValue('');
  console.log('[Callback] Cancelled event for row ' + row);
}


// ─────────────────────────────────────────────────────────────
//  rescheduleCallback — cancel old, create new
// ─────────────────────────────────────────────────────────────
function rescheduleCallback(sheet, row) {
  cancelCallback(sheet, row);
  scheduleCallback(sheet, row);
}
