package com.wuliuqc.app.model;

import org.json.JSONException;
import org.json.JSONObject;

public class Record {
    public String id = "";
    public String date = "";
    public String routeName = "";
    public String plateNumber = "";
    public int sendBlueOut;
    public int sendRedOut;
    public int blueOut;
    public int blueIn;
    public int redOut;
    public int redIn;
    public String remark = "";
    public String createTime = "";
    public long updatedAt;
    public long deletedAt;
    public boolean synced;

    public int totalOut() {
        return blueOut + redOut;
    }

    public int totalIn() {
        return blueIn + redIn;
    }

    public JSONObject toJson() throws JSONException {
        JSONObject json = new JSONObject();
        json.put("id", id);
        json.put("date", date);
        json.put("routeName", routeName);
        json.put("plateNumber", plateNumber);
        json.put("sendBlueOut", sendBlueOut);
        json.put("sendRedOut", sendRedOut);
        json.put("blueOut", blueOut);
        json.put("blueIn", blueIn);
        json.put("redOut", redOut);
        json.put("redIn", redIn);
        json.put("remark", remark);
        json.put("createTime", createTime);
        json.put("updatedAt", updatedAt);
        json.put("deletedAt", deletedAt);
        json.put("synced", synced);
        return json;
    }

    public static Record fromJson(JSONObject json) {
        Record record = new Record();
        record.id = json.optString("id", json.optString("_id", ""));
        record.date = json.optString("date", "");
        record.routeName = json.optString("routeName", "");
        record.plateNumber = json.optString("plateNumber", "");
        record.sendBlueOut = json.optInt("sendBlueOut", 0);
        record.sendRedOut = json.optInt("sendRedOut", 0);
        record.blueOut = json.optInt("blueOut", 0);
        record.blueIn = json.optInt("blueIn", 0);
        record.redOut = json.optInt("redOut", 0);
        record.redIn = json.optInt("redIn", 0);
        record.remark = json.optString("remark", "");
        record.createTime = json.optString("createTime", "");
        record.updatedAt = json.optLong("updatedAt", System.currentTimeMillis());
        record.deletedAt = json.optLong("deletedAt", 0L);
        record.synced = json.optBoolean("synced", false);
        return record;
    }
}
