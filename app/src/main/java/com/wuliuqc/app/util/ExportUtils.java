package com.wuliuqc.app.util;

import com.wuliuqc.app.model.Record;
import com.wuliuqc.app.model.Stats;

import java.util.List;

public final class ExportUtils {
    private ExportUtils() {
    }

    public static String recordsToCsv(List<Record> records) {
        StringBuilder builder = new StringBuilder();
        builder.append('\uFEFF');
        builder.append("日期,线路,车牌,物流蓝框发出,物流红框发出,蓝框发出,蓝框收回,红框发出,红框收回,备注,创建时间\n");
        for (Record record : records) {
            builder.append(csv(record.date)).append(',')
                    .append(csv(record.routeName)).append(',')
                    .append(csv(record.plateNumber)).append(',')
                    .append(record.sendBlueOut).append(',')
                    .append(record.sendRedOut).append(',')
                    .append(record.blueOut).append(',')
                    .append(record.blueIn).append(',')
                    .append(record.redOut).append(',')
                    .append(record.redIn).append(',')
                    .append(csv(record.remark)).append(',')
                    .append(csv(record.createTime)).append('\n');
        }
        Stats stats = RecordAnalytics.calculateStats(records);
        builder.append("合计,,,")
                .append(stats.sendBlueOut).append(',')
                .append(stats.sendRedOut).append(',')
                .append(stats.blueOut).append(',')
                .append(stats.blueIn).append(',')
                .append(stats.redOut).append(',')
                .append(stats.redIn).append(",,\n");
        return builder.toString();
    }

    private static String csv(String value) {
        String safe = value == null ? "" : value;
        if (safe.contains(",") || safe.contains("\"") || safe.contains("\n")) {
            return "\"" + safe.replace("\"", "\"\"") + "\"";
        }
        return safe;
    }
}
