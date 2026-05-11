// ============================================================================
//  CallbackScheduler.gs — Google Calendar callback reminders
//
//  When agent sets both CB Date + CB Time on a lead row:
//  → Creates a Google Calendar event on the editing agent's own calendar
//  → Agent gets popup notifications (5 min before + at exact time)
//
//  Works because each agent has their own installable onEdit trigger
//  with triggerOwner === activeUser guard. CalendarApp.getDefaultCalendar()
//  runs under the editing agent's OAuth context = their personal calendar.
//
//  Event IDs stored in the "Cal Event ID" sheet column (calEventId field)
//  so the correct event can be updated/deleted on reschedule or clear.
// ============================================================================


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
  var remark = (val('remark') || '').toString().trim();

  var cbDateObj = (M.cbDate !== undefined) ? sheet.getRange(row, M.cbDate + 1).getValue() : null;
  var cbTimeObj = (M.cbTime !== undefined) ? sheet.getRange(row, M.cbTime + 1).getValue() : null;

  if (!cbDateObj || !cbTimeObj) {
    console.warn('[Callback] scheduleCallback called without both cbDate and cbTime — skipping');
    return;
  }

  var startTime = new Date(cbDateObj);
  startTime.setHours(cbTimeObj.getHours(), cbTimeObj.getMinutes(), 0, 0);
  var endTime = new Date(startTime.getTime() + 20 * 60 * 1000);

  var title = '📞 Callback: ' + name + ' (' + cgid + ')';
  var description =
    'Lead: ' + name + '\n' +
    (remark ? 'Remark: ' + remark : '');

  var calendar = CalendarApp.getDefaultCalendar();
  var event = calendar.createEvent(title, startTime, endTime, {
    description: description,
    location: number,
  });
  event.addPopupReminder(5);
  event.addPopupReminder(0);

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