package com.wuliuqc.app.util;

import com.wuliuqc.app.model.BucketStat;
import com.wuliuqc.app.model.Record;
import com.wuliuqc.app.model.RouteSummary;
import com.wuliuqc.app.model.Stats;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class RecordAnalytics {
    private RecordAnalytics() {
    }

    public static Stats calculateStats(List<Record> records) {
        Stats stats = new Stats();
        for (Record record : records) {
            stats.sendBlueOut += record.sendBlueOut;
            stats.sendRedOut += record.sendRedOut;
            stats.blueOut += record.blueOut;
            stats.blueIn += record.blueIn;
            stats.redOut += record.redOut;
            stats.redIn += record.redIn;
            stats.recordCount += 1;
        }
        return stats;
    }

    public static List<Record> filter(List<Record> records, String keyword, String startDate, String endDate, String routeName, String month, String year) {
        String normalizedKeyword = keyword == null ? "" : keyword.trim().toLowerCase(Locale.ROOT);
        List<Record> filtered = new ArrayList<>();
        for (Record record : records) {
            if (routeName != null && !routeName.isEmpty() && !routeName.equals(record.routeName)) continue;
            if (startDate != null && !startDate.isEmpty() && record.date.compareTo(startDate) < 0) continue;
            if (endDate != null && !endDate.isEmpty() && record.date.compareTo(endDate) > 0) continue;
            if (month != null && !month.isEmpty() && !record.date.startsWith(month)) continue;
            if (year != null && !year.isEmpty() && !record.date.startsWith(year)) continue;
            if (!normalizedKeyword.isEmpty()) {
                String target = (record.routeName + " " + record.plateNumber + " " + record.remark).toLowerCase(Locale.ROOT);
                if (!target.contains(normalizedKeyword)) continue;
            }
            filtered.add(record);
        }
        return filtered;
    }

    public static List<RouteSummary> groupByRoute(List<Record> records) {
        Map<String, RouteSummary> map = new LinkedHashMap<>();
        for (Record record : records) {
            String route = record.routeName == null || record.routeName.isEmpty() ? "未填写线路" : record.routeName;
            RouteSummary summary = map.get(route);
            if (summary == null) {
                summary = new RouteSummary();
                summary.routeName = route;
                map.put(route, summary);
            }
            summary.sendBlueOut += record.sendBlueOut;
            summary.sendRedOut += record.sendRedOut;
            summary.blueOut += record.blueOut;
            summary.blueIn += record.blueIn;
            summary.redOut += record.redOut;
            summary.redIn += record.redIn;
            summary.recordCount += 1;
        }
        List<RouteSummary> result = new ArrayList<>(map.values());
        Collections.sort(result, (a, b) -> Integer.compare(b.volume(), a.volume()));
        return result;
    }

    public static Map<String, List<Record>> groupByDate(List<Record> records) {
        Map<String, List<Record>> groups = new LinkedHashMap<>();
        List<Record> sorted = new ArrayList<>(records);
        Collections.sort(sorted, (a, b) -> {
            int byDate = b.date.compareTo(a.date);
            if (byDate != 0) return byDate;
            return b.createTime.compareTo(a.createTime);
        });
        for (Record record : sorted) {
            if (!groups.containsKey(record.date)) {
                groups.put(record.date, new ArrayList<>());
            }
            groups.get(record.date).add(record);
        }
        return groups;
    }

    public static List<BucketStat> dailyTrend(List<Record> records) {
        Map<String, BucketStat> map = new LinkedHashMap<>();
        List<Record> sorted = new ArrayList<>(records);
        Collections.sort(sorted, Comparator.comparing(record -> record.date));
        for (Record record : sorted) {
            BucketStat bucket = map.get(record.date);
            if (bucket == null) {
                bucket = new BucketStat(record.date);
                map.put(record.date, bucket);
            }
            add(bucket, record);
        }
        return new ArrayList<>(map.values());
    }

    public static List<BucketStat> monthlyTrend(List<Record> records) {
        Map<String, BucketStat> map = new LinkedHashMap<>();
        List<Record> sorted = new ArrayList<>(records);
        Collections.sort(sorted, Comparator.comparing(record -> record.date));
        for (Record record : sorted) {
            String label = record.date.length() >= 7 ? record.date.substring(5, 7) + "月" : "未知";
            BucketStat bucket = map.get(label);
            if (bucket == null) {
                bucket = new BucketStat(label);
                map.put(label, bucket);
            }
            add(bucket, record);
        }
        return new ArrayList<>(map.values());
    }

    private static void add(BucketStat bucket, Record record) {
        bucket.blueOut += record.blueOut;
        bucket.blueIn += record.blueIn;
        bucket.redOut += record.redOut;
        bucket.redIn += record.redIn;
    }
}
