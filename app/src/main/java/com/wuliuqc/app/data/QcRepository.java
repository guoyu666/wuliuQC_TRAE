package com.wuliuqc.app.data;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.text.TextUtils;

import com.wuliuqc.app.model.Record;
import com.wuliuqc.app.util.DateUtils;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

public class QcRepository {
    public static final String TYPE_ROUTE = "route";
    public static final String TYPE_PLATE = "plate";

    private final QcDatabase helper;

    public QcRepository(Context context) {
        helper = new QcDatabase(context.getApplicationContext());
    }

    public Record addRecord(Record source) {
        Record record = copyForSave(source);
        long now = System.currentTimeMillis();
        if (TextUtils.isEmpty(record.id)) record.id = now + "-" + UUID.randomUUID().toString().substring(0, 8);
        if (TextUtils.isEmpty(record.createTime)) record.createTime = DateUtils.formatTime(new Date());
        record.updatedAt = now;
        record.deletedAt = 0L;
        record.synced = false;
        SQLiteDatabase db = helper.getWritableDatabase();
        db.insertWithOnConflict("records", null, toValues(record), SQLiteDatabase.CONFLICT_REPLACE);
        addDictionary(TYPE_ROUTE, record.routeName);
        addDictionary(TYPE_PLATE, record.plateNumber);
        return record;
    }

    public boolean updateRecord(String id, Record updates) {
        Record existing = getRecord(id, true);
        if (existing == null) return false;
        existing.routeName = clean(updates.routeName);
        existing.plateNumber = clean(updates.plateNumber);
        existing.sendBlueOut = Math.max(0, updates.sendBlueOut);
        existing.sendRedOut = Math.max(0, updates.sendRedOut);
        existing.blueOut = Math.max(0, updates.blueOut);
        existing.blueIn = Math.max(0, updates.blueIn);
        existing.redOut = Math.max(0, updates.redOut);
        existing.redIn = Math.max(0, updates.redIn);
        existing.remark = clean(updates.remark);
        existing.updatedAt = System.currentTimeMillis();
        existing.synced = false;
        helper.getWritableDatabase().insertWithOnConflict("records", null, toValues(existing), SQLiteDatabase.CONFLICT_REPLACE);
        addDictionary(TYPE_ROUTE, existing.routeName);
        addDictionary(TYPE_PLATE, existing.plateNumber);
        return true;
    }

    public boolean deleteRecord(String id) {
        Record existing = getRecord(id, true);
        if (existing == null) return false;
        existing.updatedAt = System.currentTimeMillis();
        existing.deletedAt = existing.updatedAt;
        existing.synced = false;
        helper.getWritableDatabase().insertWithOnConflict("records", null, toValues(existing), SQLiteDatabase.CONFLICT_REPLACE);
        return true;
    }

    public Record getRecord(String id) {
        return getRecord(id, false);
    }

    public Record getRecord(String id, boolean includeDeleted) {
        String selection = includeDeleted ? "id=?" : "id=? AND deleted_at=0";
        Cursor cursor = helper.getReadableDatabase().query("records", null, selection, new String[]{id}, null, null, null, "1");
        try {
            if (cursor.moveToFirst()) return fromCursor(cursor);
            return null;
        } finally {
            cursor.close();
        }
    }

    public List<Record> getRecords() {
        return getRecords(false);
    }

    public List<Record> getRecords(boolean includeDeleted) {
        String selection = includeDeleted ? null : "deleted_at=0";
        Cursor cursor = helper.getReadableDatabase().query(
                "records",
                null,
                selection,
                null,
                null,
                null,
                "date DESC, create_time DESC, updated_at DESC"
        );
        try {
            List<Record> records = new ArrayList<>();
            while (cursor.moveToNext()) {
                records.add(fromCursor(cursor));
            }
            return records;
        } finally {
            cursor.close();
        }
    }

    public List<Record> getRecordsForDate(String date) {
        Cursor cursor = helper.getReadableDatabase().query(
                "records",
                null,
                "deleted_at=0 AND date=?",
                new String[]{date},
                null,
                null,
                "create_time DESC, updated_at DESC"
        );
        try {
            List<Record> records = new ArrayList<>();
            while (cursor.moveToNext()) records.add(fromCursor(cursor));
            return records;
        } finally {
            cursor.close();
        }
    }

    public List<String> getRoutes() {
        return getDictionary(TYPE_ROUTE);
    }

    public List<String> getPlates() {
        return getDictionary(TYPE_PLATE);
    }

    public List<String> addRoute(String route) {
        addDictionary(TYPE_ROUTE, route);
        return getRoutes();
    }

    public List<String> addPlate(String plate) {
        addDictionary(TYPE_PLATE, plate);
        return getPlates();
    }

    public List<String> deleteRoute(String route) {
        deleteDictionary(TYPE_ROUTE, route);
        return getRoutes();
    }

    public List<String> deletePlate(String plate) {
        deleteDictionary(TYPE_PLATE, plate);
        return getPlates();
    }

    public JSONObject getSyncStatus() throws JSONException {
        List<Record> visible = getRecords(false);
        List<Record> all = getRecords(true);
        int unsynced = 0;
        for (Record record : visible) {
            if (!record.synced) unsynced += 1;
        }
        JSONObject status = new JSONObject();
        status.put("mode", "本地模式");
        status.put("visibleTotal", visible.size());
        status.put("deletedPending", all.size() - visible.size());
        status.put("unsynced", unsynced);
        status.put("message", "Android 版已完整支持本地数据；云端同步接口保留，需接入独立后端或迁移微信云函数后启用。");
        return status;
    }

    public String exportAllData() throws JSONException {
        JSONObject root = new JSONObject();
        root.put("version", "android-1.0");
        root.put("timestamp", new Date().toString());
        root.put("records", recordsToJson(getRecords(true)));
        root.put("routes", stringsToJson(getRoutes()));
        root.put("plates", stringsToJson(getPlates()));
        root.put("routesMeta", new JSONObject());
        root.put("platesMeta", new JSONObject());
        return root.toString(2);
    }

    public int importAllData(String json) throws JSONException {
        JSONObject root = new JSONObject(json);
        JSONArray recordsJson = root.optJSONArray("records");
        if (recordsJson == null) {
            throw new JSONException("无效的备份文件：缺少 records");
        }
        List<Record> records = new ArrayList<>();
        long importedAt = System.currentTimeMillis();
        for (int i = 0; i < recordsJson.length(); i++) {
            Record record = Record.fromJson(recordsJson.getJSONObject(i));
            if (TextUtils.isEmpty(record.id)) record.id = importedAt + "-" + i;
            if (TextUtils.isEmpty(record.createTime)) record.createTime = DateUtils.formatTime(new Date(importedAt));
            record.updatedAt = importedAt;
            record.synced = false;
            records.add(record);
        }
        List<String> routes = jsonArrayToStrings(root.optJSONArray("routes"));
        List<String> plates = jsonArrayToStrings(root.optJSONArray("plates"));

        for (Record record : records) {
            if (!TextUtils.isEmpty(record.routeName)) routes.add(record.routeName);
            if (!TextUtils.isEmpty(record.plateNumber)) plates.add(record.plateNumber);
        }
        replaceAll(records, routes, plates);
        return records.size();
    }

    public void clearAll() {
        SQLiteDatabase db = helper.getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("records", null, null);
            db.delete("dictionaries", null, null);
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    private void replaceAll(List<Record> records, List<String> routes, List<String> plates) {
        SQLiteDatabase db = helper.getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("records", null, null);
            db.delete("dictionaries", null, null);
            for (Record record : records) {
                db.insertWithOnConflict("records", null, toValues(record), SQLiteDatabase.CONFLICT_REPLACE);
            }
            int order = 1;
            for (String route : unique(routes)) {
                insertDictionary(db, TYPE_ROUTE, route, order++);
            }
            order = 1;
            for (String plate : unique(plates)) {
                insertDictionary(db, TYPE_PLATE, plate, order++);
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    private List<String> getDictionary(String type) {
        Cursor cursor = helper.getReadableDatabase().query(
                "dictionaries",
                new String[]{"name"},
                "type=? AND deleted_at=0",
                new String[]{type},
                null,
                null,
                "sort_order ASC, name COLLATE LOCALIZED ASC"
        );
        try {
            List<String> values = new ArrayList<>();
            while (cursor.moveToNext()) values.add(cursor.getString(0));
            return values;
        } finally {
            cursor.close();
        }
    }

    private void addDictionary(String type, String value) {
        String name = clean(value);
        if (TextUtils.isEmpty(name)) return;
        SQLiteDatabase db = helper.getWritableDatabase();
        insertDictionary(db, type, name, nextOrder(db, type));
    }

    private void insertDictionary(SQLiteDatabase db, String type, String name, int order) {
        String cleanName = clean(name);
        if (TextUtils.isEmpty(cleanName)) return;
        ContentValues values = new ContentValues();
        values.put("type", type);
        values.put("name", cleanName);
        values.put("updated_at", System.currentTimeMillis());
        values.put("deleted_at", 0L);
        values.put("sort_order", order);
        db.insertWithOnConflict("dictionaries", null, values, SQLiteDatabase.CONFLICT_IGNORE);
        ContentValues revive = new ContentValues();
        revive.put("deleted_at", 0L);
        revive.put("updated_at", System.currentTimeMillis());
        db.update("dictionaries", revive, "type=? AND name=?", new String[]{type, cleanName});
    }

    private void deleteDictionary(String type, String value) {
        String name = clean(value);
        if (TextUtils.isEmpty(name)) return;
        ContentValues values = new ContentValues();
        long now = System.currentTimeMillis();
        values.put("deleted_at", now);
        values.put("updated_at", now);
        helper.getWritableDatabase().update("dictionaries", values, "type=? AND name=?", new String[]{type, name});
    }

    private int nextOrder(SQLiteDatabase db, String type) {
        Cursor cursor = db.rawQuery("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM dictionaries WHERE type=?", new String[]{type});
        try {
            return cursor.moveToFirst() ? cursor.getInt(0) : 1;
        } finally {
            cursor.close();
        }
    }

    private Record copyForSave(Record source) {
        Record record = new Record();
        record.id = source.id;
        record.date = clean(source.date);
        record.routeName = clean(source.routeName);
        record.plateNumber = clean(source.plateNumber).toUpperCase(Locale.ROOT);
        record.sendBlueOut = Math.max(0, source.sendBlueOut);
        record.sendRedOut = Math.max(0, source.sendRedOut);
        record.blueOut = Math.max(0, source.blueOut);
        record.blueIn = Math.max(0, source.blueIn);
        record.redOut = Math.max(0, source.redOut);
        record.redIn = Math.max(0, source.redIn);
        record.remark = clean(source.remark);
        record.createTime = source.createTime;
        return record;
    }

    private ContentValues toValues(Record record) {
        ContentValues values = new ContentValues();
        values.put("id", record.id);
        values.put("date", record.date);
        values.put("route_name", record.routeName);
        values.put("plate_number", record.plateNumber);
        values.put("send_blue_out", record.sendBlueOut);
        values.put("send_red_out", record.sendRedOut);
        values.put("blue_out", record.blueOut);
        values.put("blue_in", record.blueIn);
        values.put("red_out", record.redOut);
        values.put("red_in", record.redIn);
        values.put("remark", record.remark);
        values.put("create_time", record.createTime);
        values.put("updated_at", record.updatedAt);
        values.put("deleted_at", record.deletedAt);
        values.put("synced", record.synced ? 1 : 0);
        return values;
    }

    private Record fromCursor(Cursor cursor) {
        Record record = new Record();
        record.id = cursor.getString(cursor.getColumnIndexOrThrow("id"));
        record.date = cursor.getString(cursor.getColumnIndexOrThrow("date"));
        record.routeName = cursor.getString(cursor.getColumnIndexOrThrow("route_name"));
        record.plateNumber = cursor.getString(cursor.getColumnIndexOrThrow("plate_number"));
        record.sendBlueOut = cursor.getInt(cursor.getColumnIndexOrThrow("send_blue_out"));
        record.sendRedOut = cursor.getInt(cursor.getColumnIndexOrThrow("send_red_out"));
        record.blueOut = cursor.getInt(cursor.getColumnIndexOrThrow("blue_out"));
        record.blueIn = cursor.getInt(cursor.getColumnIndexOrThrow("blue_in"));
        record.redOut = cursor.getInt(cursor.getColumnIndexOrThrow("red_out"));
        record.redIn = cursor.getInt(cursor.getColumnIndexOrThrow("red_in"));
        record.remark = cursor.getString(cursor.getColumnIndexOrThrow("remark"));
        record.createTime = cursor.getString(cursor.getColumnIndexOrThrow("create_time"));
        record.updatedAt = cursor.getLong(cursor.getColumnIndexOrThrow("updated_at"));
        record.deletedAt = cursor.getLong(cursor.getColumnIndexOrThrow("deleted_at"));
        record.synced = cursor.getInt(cursor.getColumnIndexOrThrow("synced")) == 1;
        return record;
    }

    private JSONArray recordsToJson(List<Record> records) throws JSONException {
        JSONArray array = new JSONArray();
        for (Record record : records) array.put(record.toJson());
        return array;
    }

    private JSONArray stringsToJson(List<String> values) {
        JSONArray array = new JSONArray();
        for (String value : values) array.put(value);
        return array;
    }

    private List<String> jsonArrayToStrings(JSONArray array) throws JSONException {
        List<String> values = new ArrayList<>();
        if (array == null) return values;
        for (int i = 0; i < array.length(); i++) {
            String value = clean(array.getString(i));
            if (!TextUtils.isEmpty(value)) values.add(value);
        }
        return values;
    }

    private List<String> unique(List<String> source) {
        Set<String> set = new LinkedHashSet<>();
        for (String value : source) {
            String clean = clean(value);
            if (!TextUtils.isEmpty(clean)) set.add(clean);
        }
        return new ArrayList<>(set);
    }

    private String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
