package com.wuliuqc.app.data;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

public class QcDatabase extends SQLiteOpenHelper {
    private static final String DATABASE_NAME = "wuliu_qc.db";
    private static final int DATABASE_VERSION = 1;

    public QcDatabase(Context context) {
        super(context, DATABASE_NAME, null, DATABASE_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE records (" +
                "id TEXT PRIMARY KEY," +
                "date TEXT NOT NULL," +
                "route_name TEXT NOT NULL," +
                "plate_number TEXT NOT NULL," +
                "send_blue_out INTEGER NOT NULL DEFAULT 0," +
                "send_red_out INTEGER NOT NULL DEFAULT 0," +
                "blue_out INTEGER NOT NULL DEFAULT 0," +
                "blue_in INTEGER NOT NULL DEFAULT 0," +
                "red_out INTEGER NOT NULL DEFAULT 0," +
                "red_in INTEGER NOT NULL DEFAULT 0," +
                "remark TEXT NOT NULL DEFAULT ''," +
                "create_time TEXT NOT NULL," +
                "updated_at INTEGER NOT NULL," +
                "deleted_at INTEGER NOT NULL DEFAULT 0," +
                "synced INTEGER NOT NULL DEFAULT 0" +
                ")");
        db.execSQL("CREATE INDEX idx_records_date ON records(date)");
        db.execSQL("CREATE INDEX idx_records_updated_at ON records(updated_at)");

        db.execSQL("CREATE TABLE dictionaries (" +
                "type TEXT NOT NULL," +
                "name TEXT NOT NULL," +
                "updated_at INTEGER NOT NULL," +
                "deleted_at INTEGER NOT NULL DEFAULT 0," +
                "sort_order INTEGER NOT NULL DEFAULT 0," +
                "PRIMARY KEY(type, name)" +
                ")");
        db.execSQL("CREATE INDEX idx_dictionaries_type ON dictionaries(type, deleted_at, sort_order)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Future schema migrations live here. Version 1 is the Android migration baseline.
    }
}
