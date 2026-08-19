package com.devil.app147;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * Keeps a dedicated, local "147" calendar in step with the app's schedule.
 *
 * It is a LOCAL calendar (ACCOUNT_TYPE_LOCAL) — not tied to the user's Google
 * or Samsung account — which is exactly what makes it show up as its own
 * separate, independently toggleable row in Samsung Calendar (and any other
 * calendar app): it never mixes with the user's real classes/events, and one
 * tap hides the whole thing.
 *
 * Reconciliation is a full replace on every sync: delete every event under
 * our calendar, then insert the current set fresh. There is no server round
 * trip involved (it is all local ContentProvider calls), so this is cheap and
 * sidesteps any need to track which local event maps to which blurt.
 */
@CapacitorPlugin(
    name = "Calendar147",
    permissions = {
        @Permission(
            strings = { Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR },
            alias = "calendar"
        )
    }
)
public class CalendarPlugin extends Plugin {

    private static final String ACCOUNT_NAME = "147";
    private static final String CALENDAR_DISPLAY_NAME = "147";
    /** The app's accent blue, as an ARGB int. */
    private static final int CALENDAR_COLOR = 0xFF7C9CFF;

    @PluginMethod
    public void hasPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("calendar") == PermissionState.GRANTED);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        requestPermissionForAlias("calendar", call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("calendar") == PermissionState.GRANTED);
        call.resolve(ret);
    }

    /** Finds the "147" local calendar, creating it the first time. */
    private long ensureCalendar() {
        ContentResolver cr = getContext().getContentResolver();

        Cursor existing = cr.query(
            CalendarContract.Calendars.CONTENT_URI,
            new String[] { CalendarContract.Calendars._ID },
            CalendarContract.Calendars.ACCOUNT_NAME + "=? AND " + CalendarContract.Calendars.ACCOUNT_TYPE + "=?",
            new String[] { ACCOUNT_NAME, CalendarContract.ACCOUNT_TYPE_LOCAL },
            null
        );
        if (existing != null) {
            try {
                if (existing.moveToFirst()) return existing.getLong(0);
            } finally {
                existing.close();
            }
        }

        Uri calUri = CalendarContract.Calendars.CONTENT_URI.buildUpon()
            .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
            .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME, ACCOUNT_NAME)
            .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
            .build();

        ContentValues values = new ContentValues();
        values.put(CalendarContract.Calendars.ACCOUNT_NAME, ACCOUNT_NAME);
        values.put(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL);
        values.put(CalendarContract.Calendars.NAME, CALENDAR_DISPLAY_NAME);
        values.put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, CALENDAR_DISPLAY_NAME);
        values.put(CalendarContract.Calendars.CALENDAR_COLOR, CALENDAR_COLOR);
        values.put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL, CalendarContract.Calendars.CAL_ACCESS_OWNER);
        values.put(CalendarContract.Calendars.OWNER_ACCOUNT, ACCOUNT_NAME);
        values.put(CalendarContract.Calendars.VISIBLE, 1);
        values.put(CalendarContract.Calendars.SYNC_EVENTS, 1);
        values.put(CalendarContract.Calendars.CALENDAR_TIME_ZONE, TimeZone.getDefault().getID());

        Uri result = cr.insert(calUri, values);
        return result == null ? -1 : ContentUris.parseId(result);
    }

    /** yyyy-MM-dd, as UTC midnight — the format Android wants for all-day events. */
    private long utcMidnight(String isoDate) {
        String[] parts = isoDate.split("-");
        Calendar cal = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        cal.clear();
        cal.set(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]) - 1, Integer.parseInt(parts[2]));
        return cal.getTimeInMillis();
    }

    @PluginMethod
    public void sync(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            call.reject("Calendar permission not granted.");
            return;
        }

        JSArray events = call.getArray("events");
        if (events == null) {
            call.reject("Missing events array.");
            return;
        }

        try {
            ContentResolver cr = getContext().getContentResolver();
            long calId = ensureCalendar();
            if (calId < 0) {
                call.reject("Could not create the 147 calendar.");
                return;
            }

            // Full replace: delete everything under our calendar, then insert fresh.
            cr.delete(
                CalendarContract.Events.CONTENT_URI,
                CalendarContract.Events.CALENDAR_ID + "=?",
                new String[] { String.valueOf(calId) }
            );

            int written = 0;
            for (int i = 0; i < events.length(); i++) {
                JSObject ev = JSObject.fromJSONObject(events.getJSONObject(i));
                String title = ev.getString("title", "Blurt");
                String notes = ev.getString("notes", "");
                String date = ev.getString("date");
                if (date == null) continue;

                long start = utcMidnight(date);
                ContentValues values = new ContentValues();
                values.put(CalendarContract.Events.CALENDAR_ID, calId);
                values.put(CalendarContract.Events.TITLE, title);
                values.put(CalendarContract.Events.DESCRIPTION, notes);
                values.put(CalendarContract.Events.DTSTART, start);
                values.put(CalendarContract.Events.DTEND, start + 24L * 60 * 60 * 1000);
                values.put(CalendarContract.Events.EVENT_TIMEZONE, "UTC");
                values.put(CalendarContract.Events.ALL_DAY, 1);
                values.put(CalendarContract.Events.HAS_ALARM, 1);

                Uri inserted = cr.insert(CalendarContract.Events.CONTENT_URI, values);
                if (inserted != null) {
                    // For an all-day event, MINUTES=0 means "at the calendar app's own default
                    // all-day reminder time" (Samsung Calendar defaults that to 9am, and lets
                    // the user change it) rather than literal midnight.
                    ContentValues alarm = new ContentValues();
                    alarm.put(CalendarContract.Reminders.EVENT_ID, ContentUris.parseId(inserted));
                    alarm.put(CalendarContract.Reminders.MINUTES, 0);
                    alarm.put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT);
                    cr.insert(CalendarContract.Reminders.CONTENT_URI, alarm);
                    written++;
                }
            }

            JSObject ret = new JSObject();
            ret.put("written", written);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Calendar sync failed: " + e.getMessage(), e);
        }
    }
}
