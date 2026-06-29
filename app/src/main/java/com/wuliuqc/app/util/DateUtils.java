package com.wuliuqc.app.util;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

public final class DateUtils {
    private static final SimpleDateFormat DATE = new SimpleDateFormat("yyyy-MM-dd", Locale.CHINA);
    private static final SimpleDateFormat MONTH = new SimpleDateFormat("yyyy-MM", Locale.CHINA);
    private static final SimpleDateFormat TIME = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.CHINA);

    private DateUtils() {
    }

    public static String today() {
        return formatDate(new Date());
    }

    public static String currentMonth() {
        return MONTH.format(new Date());
    }

    public static String currentYear() {
        return String.valueOf(Calendar.getInstance().get(Calendar.YEAR));
    }

    public static String formatDate(Date date) {
        synchronized (DATE) {
            return DATE.format(date);
        }
    }

    public static String formatTime(Date date) {
        synchronized (TIME) {
            return TIME.format(date);
        }
    }

    public static Date parseDate(String value) {
        if (value == null || value.trim().isEmpty()) return new Date();
        try {
            synchronized (DATE) {
                return DATE.parse(value);
            }
        } catch (ParseException ignored) {
            return new Date();
        }
    }

    public static String addDays(String date, int days) {
        Calendar calendar = Calendar.getInstance();
        calendar.setTime(parseDate(date));
        calendar.add(Calendar.DAY_OF_MONTH, days);
        return formatDate(calendar.getTime());
    }

    public static String monthStart(String date) {
        Calendar calendar = Calendar.getInstance();
        calendar.setTime(parseDate(date));
        calendar.set(Calendar.DAY_OF_MONTH, 1);
        return formatDate(calendar.getTime());
    }

    public static String addMonths(String month, int delta) {
        Calendar calendar = Calendar.getInstance();
        String[] parts = month.split("-");
        int year = safeInt(parts.length > 0 ? parts[0] : currentYear(), Calendar.getInstance().get(Calendar.YEAR));
        int monthIndex = safeInt(parts.length > 1 ? parts[1] : "1", 1) - 1;
        calendar.set(year, monthIndex, 1);
        calendar.add(Calendar.MONTH, delta);
        return new SimpleDateFormat("yyyy-MM", Locale.CHINA).format(calendar.getTime());
    }

    public static String addYears(String year, int delta) {
        return String.valueOf(safeInt(year, Calendar.getInstance().get(Calendar.YEAR)) + delta);
    }

    public static int safeInt(String value, int fallback) {
        try {
            return Integer.parseInt(value);
        } catch (Exception ignored) {
            return fallback;
        }
    }
}
