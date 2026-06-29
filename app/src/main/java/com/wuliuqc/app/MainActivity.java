package com.wuliuqc.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CompoundButton;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import com.wuliuqc.app.data.QcRepository;
import com.wuliuqc.app.model.BucketStat;
import com.wuliuqc.app.model.Record;
import com.wuliuqc.app.model.RouteSummary;
import com.wuliuqc.app.model.Stats;
import com.wuliuqc.app.ui.ChartView;
import com.wuliuqc.app.util.DateUtils;
import com.wuliuqc.app.util.ExportUtils;
import com.wuliuqc.app.util.RecordAnalytics;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class MainActivity extends Activity {
    private static final int REQ_EXPORT = 1001;
    private static final int REQ_IMPORT = 1002;

    private QcRepository repository;
    private SharedPreferences prefs;
    private FrameLayout contentFrame;
    private LinearLayout navBar;

    private boolean darkMode;
    private String screen = "home";
    private String selectedDate = DateUtils.today();
    private String historyKeyword = "";
    private String historyStartDate = "";
    private String historyEndDate = "";
    private String statTab = "month";
    private String selectedMonth = DateUtils.currentMonth();
    private String selectedYear = DateUtils.currentYear();
    private String selectedRoute = "";

    private String pendingFileContent = "";
    private String pendingExportToast = "";

    private int bg;
    private int surface;
    private int primary;
    private int red;
    private int text;
    private int muted;
    private int stroke;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        repository = new QcRepository(this);
        prefs = getSharedPreferences("wuliu_qc_prefs", MODE_PRIVATE);
        darkMode = prefs.getBoolean("darkMode", false);
        applyPalette();
        buildShell();
        showHome();
    }

    private void buildShell() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(bg);

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setPadding(dp(18), dp(14), dp(18), dp(12));
        header.setBackgroundColor(primary);
        TextView title = label("物流QC框子收发记录", 20, Color.WHITE, true);
        TextView subtitle = label("Android 本地增强版", 13, Color.argb(210, 255, 255, 255), false);
        header.addView(title);
        header.addView(subtitle);
        root.addView(header, new LinearLayout.LayoutParams(-1, -2));

        contentFrame = new FrameLayout(this);
        root.addView(contentFrame, new LinearLayout.LayoutParams(-1, 0, 1));

        navBar = new LinearLayout(this);
        navBar.setOrientation(LinearLayout.HORIZONTAL);
        navBar.setPadding(dp(8), dp(6), dp(8), dp(6));
        navBar.setBackgroundColor(surface);
        root.addView(navBar, new LinearLayout.LayoutParams(-1, -2));

        setContentView(root);
        rebuildNav();
    }

    private void rebuildNav() {
        navBar.removeAllViews();
        navBar.addView(navButton("首页", "home"), weightParams());
        navBar.addView(navButton("历史", "history"), weightParams());
        navBar.addView(navButton("统计", "stats"), weightParams());
        navBar.addView(navButton("设置", "settings"), weightParams());
    }

    private Button navButton(String title, String target) {
        Button button = button(title);
        boolean active = target.equals(screen);
        button.setTextColor(active ? Color.WHITE : primary);
        button.setBackgroundColor(active ? primary : surface);
        button.setOnClickListener(v -> {
            if ("home".equals(target)) showHome();
            if ("history".equals(target)) showHistory();
            if ("stats".equals(target)) showStats();
            if ("settings".equals(target)) showSettings();
        });
        return button;
    }

    private void showHome() {
        screen = "home";
        rebuildNav();
        LinearLayout page = page();
        List<Record> dayRecords = repository.getRecordsForDate(selectedDate);
        Stats stats = RecordAnalytics.calculateStats(dayRecords);

        page.addView(sectionTitle("今日/指定日期记录"));
        LinearLayout dateCard = card();
        LinearLayout dateRow = row();
        Button dateButton = button(selectedDate);
        dateButton.setOnClickListener(v -> pickDate(selectedDate, value -> {
            selectedDate = value;
            showHome();
        }));
        dateRow.addView(dateButton, weightParams());
        dateRow.addView(button("今天", v -> {
            selectedDate = DateUtils.today();
            showHome();
        }));
        dateCard.addView(dateRow);
        LinearLayout quickRow = wrapRow();
        quickRow.addView(button("昨天", v -> {
            selectedDate = DateUtils.addDays(DateUtils.today(), -1);
            showHome();
        }));
        quickRow.addView(button("上周", v -> {
            selectedDate = DateUtils.addDays(selectedDate, -7);
            showHome();
        }));
        quickRow.addView(button("月初", v -> {
            selectedDate = DateUtils.monthStart(selectedDate);
            showHome();
        }));
        dateCard.addView(quickRow);
        page.addView(dateCard);

        page.addView(summaryCard(stats));
        ChartView chartView = new ChartView(this);
        chartView.setStats(stats, text);
        LinearLayout chartCard = card();
        chartCard.addView(label("收发对比", 16, text, true));
        chartCard.addView(chartView, new LinearLayout.LayoutParams(-1, dp(190)));
        page.addView(chartCard);

        page.addView(sectionTitle("新增收发记录"));
        LinearLayout form = card();
        EditText routeInput = input("线路名称，例如：京沪线");
        EditText plateInput = input("车牌号，例如：沪A12345");
        addDictionaryPicker(form, "线路", routeInput, repository.getRoutes(), true);
        addDictionaryPicker(form, "车牌", plateInput, repository.getPlates(), false);

        CounterField sendBlue = addCounter(form, "物流蓝框发出");
        CounterField sendRed = addCounter(form, "物流红框发出");
        CounterField blueOut = addCounter(form, "蓝框发出");
        CounterField blueIn = addCounter(form, "蓝框收回");
        CounterField redOut = addCounter(form, "红框发出");
        CounterField redIn = addCounter(form, "红框收回");
        EditText remarkInput = input("备注，可选");
        form.addView(field("备注", remarkInput));

        Button submit = button("保存记录");
        submit.setTextColor(Color.WHITE);
        submit.setBackgroundColor(primary);
        submit.setOnClickListener(v -> {
            Record record = new Record();
            record.date = selectedDate;
            record.routeName = textOf(routeInput);
            record.plateNumber = textOf(plateInput);
            record.sendBlueOut = sendBlue.value();
            record.sendRedOut = sendRed.value();
            record.blueOut = blueOut.value();
            record.blueIn = blueIn.value();
            record.redOut = redOut.value();
            record.redIn = redIn.value();
            record.remark = textOf(remarkInput);
            if (TextUtils.isEmpty(record.routeName)) {
                toast("请输入线路名称");
                return;
            }
            if (TextUtils.isEmpty(record.plateNumber)) {
                toast("请输入车牌号");
                return;
            }
            if (record.sendBlueOut == 0 && record.sendRedOut == 0 && record.blueOut == 0 && record.blueIn == 0 && record.redOut == 0 && record.redIn == 0 && TextUtils.isEmpty(record.remark)) {
                toast("请输入数量或备注");
                return;
            }
            repository.addRecord(record);
            toast("记录已保存");
            showHome();
        });
        form.addView(submit, fullParams());
        page.addView(form);

        List<RouteSummary> routeSummaries = RecordAnalytics.groupByRoute(dayRecords);
        if (!routeSummaries.isEmpty()) {
            page.addView(sectionTitle("线路汇总"));
            for (RouteSummary summary : routeSummaries) {
                LinearLayout item = card();
                item.addView(label(summary.routeName + " · " + summary.recordCount + "条", 16, text, true));
                item.addView(label("物流蓝出 " + summary.sendBlueOut + "  物流红出 " + summary.sendRedOut, 13, muted, false));
                item.addView(label("蓝出/入 " + summary.blueOut + "/" + summary.blueIn + "   红出/入 " + summary.redOut + "/" + summary.redIn, 13, muted, false));
                page.addView(item);
            }
        }

        setPage(page);
    }

    private void showHistory() {
        screen = "history";
        rebuildNav();
        LinearLayout page = page();
        List<Record> all = repository.getRecords();
        List<Record> filtered = RecordAnalytics.filter(all, historyKeyword, historyStartDate, historyEndDate, "", "", "");
        Stats stats = RecordAnalytics.calculateStats(filtered);

        page.addView(sectionTitle("历史记录"));
        LinearLayout filter = card();
        EditText keyword = input("搜索线路、车牌、备注");
        keyword.setText(historyKeyword);
        filter.addView(keyword, fullParams());
        LinearLayout dateRow = wrapRow();
        dateRow.addView(button(TextUtils.isEmpty(historyStartDate) ? "开始日期" : historyStartDate, v -> pickDate(defaultDate(historyStartDate), value -> {
            historyStartDate = value;
            showHistory();
        })));
        dateRow.addView(button(TextUtils.isEmpty(historyEndDate) ? "结束日期" : historyEndDate, v -> pickDate(defaultDate(historyEndDate), value -> {
            historyEndDate = value;
            showHistory();
        })));
        dateRow.addView(button("筛选", v -> {
            historyKeyword = textOf(keyword);
            showHistory();
        }));
        dateRow.addView(button("清空", v -> {
            historyKeyword = "";
            historyStartDate = "";
            historyEndDate = "";
            showHistory();
        }));
        filter.addView(dateRow);
        LinearLayout exportRow = wrapRow();
        exportRow.addView(button("导出CSV", v -> exportRecords(filtered)));
        exportRow.addView(button("备份JSON", v -> exportBackup()));
        exportRow.addView(button("导入JSON", v -> importBackup()));
        filter.addView(exportRow);
        page.addView(filter);
        page.addView(summaryCard(stats));

        if (filtered.isEmpty()) {
            page.addView(emptyCard("暂无记录"));
        } else {
            int rendered = 0;
            Map<String, List<Record>> groups = RecordAnalytics.groupByDate(filtered);
            for (Map.Entry<String, List<Record>> entry : groups.entrySet()) {
                Stats dayStats = RecordAnalytics.calculateStats(entry.getValue());
                page.addView(dateHeader(entry.getKey(), dayStats));
                for (Record record : entry.getValue()) {
                    if (rendered >= 300) break;
                    page.addView(recordCard(record));
                    rendered++;
                }
                if (rendered >= 300) break;
            }
            if (filtered.size() > rendered) {
                page.addView(emptyCard("已显示前 " + rendered + " 条，可通过日期或关键词缩小范围后继续查看"));
            }
        }
        setPage(page);
    }

    private void showStats() {
        screen = "stats";
        rebuildNav();
        LinearLayout page = page();
        page.addView(sectionTitle("统计报表"));

        LinearLayout controls = card();
        LinearLayout tabs = row();
        Button monthTab = button("月度");
        Button yearTab = button("年度");
        monthTab.setTextColor("month".equals(statTab) ? Color.WHITE : primary);
        monthTab.setBackgroundColor("month".equals(statTab) ? primary : surface);
        yearTab.setTextColor("year".equals(statTab) ? Color.WHITE : primary);
        yearTab.setBackgroundColor("year".equals(statTab) ? primary : surface);
        monthTab.setOnClickListener(v -> {
            statTab = "month";
            showStats();
        });
        yearTab.setOnClickListener(v -> {
            statTab = "year";
            showStats();
        });
        tabs.addView(monthTab, weightParams());
        tabs.addView(yearTab, weightParams());
        controls.addView(tabs);

        Spinner routeSpinner = spinner(withAll(repository.getRoutes()));
        int selectedRouteIndex = routeIndex(routeSpinner, selectedRoute);
        routeSpinner.setSelection(selectedRouteIndex);
        routeSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                String route = String.valueOf(parent.getItemAtPosition(position));
                String value = "全部线路".equals(route) ? "" : route;
                if (!value.equals(selectedRoute)) {
                    selectedRoute = value;
                    showStats();
                }
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
            }
        });
        controls.addView(field("线路筛选", routeSpinner));

        LinearLayout periodRow = wrapRow();
        periodRow.addView(button("上一" + ("month".equals(statTab) ? "月" : "年"), v -> {
            if ("month".equals(statTab)) selectedMonth = DateUtils.addMonths(selectedMonth, -1);
            else selectedYear = DateUtils.addYears(selectedYear, -1);
            showStats();
        }));
        periodRow.addView(button(currentPeriod(), v -> {
            if ("month".equals(statTab)) pickMonth();
            else pickYear();
        }));
        periodRow.addView(button("当前", v -> {
            selectedMonth = DateUtils.currentMonth();
            selectedYear = DateUtils.currentYear();
            showStats();
        }));
        periodRow.addView(button("下一" + ("month".equals(statTab) ? "月" : "年"), v -> {
            if ("month".equals(statTab)) selectedMonth = DateUtils.addMonths(selectedMonth, 1);
            else selectedYear = DateUtils.addYears(selectedYear, 1);
            showStats();
        }));
        controls.addView(periodRow);
        page.addView(controls);

        List<Record> records = repository.getRecords();
        List<Record> filtered = "month".equals(statTab)
                ? RecordAnalytics.filter(records, "", "", "", selectedRoute, selectedMonth, "")
                : RecordAnalytics.filter(records, "", "", "", selectedRoute, "", selectedYear);
        Stats stats = RecordAnalytics.calculateStats(filtered);
        page.addView(summaryCard(stats));
        LinearLayout chartCard = card();
        chartCard.addView(label("收发对比", 16, text, true));
        ChartView chart = new ChartView(this);
        chart.setStats(stats, text);
        chartCard.addView(chart, new LinearLayout.LayoutParams(-1, dp(190)));
        page.addView(chartCard);

        List<BucketStat> trend = "month".equals(statTab)
                ? RecordAnalytics.dailyTrend(filtered)
                : RecordAnalytics.monthlyTrend(filtered);
        page.addView(sectionTitle("趋势明细"));
        if (trend.isEmpty()) {
            page.addView(emptyCard("当前范围暂无数据"));
        } else {
            int max = 1;
            for (BucketStat bucket : trend) max = Math.max(max, bucket.total());
            for (BucketStat bucket : trend) page.addView(trendRow(bucket, max));
        }
        setPage(page);
    }

    private void showSettings() {
        screen = "settings";
        rebuildNav();
        LinearLayout page = page();
        page.addView(sectionTitle("设置与数据管理"));

        LinearLayout themeCard = card();
        Switch darkSwitch = new Switch(this);
        darkSwitch.setText("深色主题");
        darkSwitch.setTextColor(text);
        darkSwitch.setTextSize(16);
        darkSwitch.setChecked(darkMode);
        darkSwitch.setOnCheckedChangeListener((CompoundButton buttonView, boolean isChecked) -> {
            darkMode = isChecked;
            prefs.edit().putBoolean("darkMode", darkMode).apply();
            applyPalette();
            buildShell();
            showSettings();
        });
        themeCard.addView(darkSwitch);
        page.addView(themeCard);

        LinearLayout statusCard = card();
        try {
            JSONObject status = repository.getSyncStatus();
            statusCard.addView(label("同步状态：" + status.optString("mode"), 16, text, true));
            statusCard.addView(label("记录 " + status.optInt("visibleTotal") + " 条，待同步 " + status.optInt("unsynced") + " 条", 13, muted, false));
            statusCard.addView(label(status.optString("message"), 13, muted, false));
        } catch (Exception e) {
            statusCard.addView(label("同步状态读取失败", 16, text, true));
        }
        page.addView(statusCard);

        LinearLayout dataCard = card();
        dataCard.addView(label("数据操作", 16, text, true));
        LinearLayout actions = wrapRow();
        actions.addView(button("导出CSV", v -> exportRecords(repository.getRecords())));
        actions.addView(button("备份JSON", v -> exportBackup()));
        actions.addView(button("导入JSON", v -> importBackup()));
        actions.addView(button("清空全部", v -> confirmClear()));
        dataCard.addView(actions);
        page.addView(dataCard);

        LinearLayout about = card();
        about.addView(label("迁移说明", 16, text, true));
        about.addView(label("本 Android 版已覆盖小程序的录入、历史、统计、字典、备份和导出功能。微信云开发无法在原生 Android 端直接复用，后续可把云函数迁移为 HTTP 服务后接入同步。", 13, muted, false));
        page.addView(about);
        setPage(page);
    }

    private void addDictionaryPicker(LinearLayout form, String title, EditText target, List<String> values, boolean route) {
        LinearLayout group = new LinearLayout(this);
        group.setOrientation(LinearLayout.VERTICAL);
        group.addView(label(title, 14, muted, false));
        Spinner spinner = spinner(withPlaceholder(values, "选择" + title));
        spinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                if (position > 0) target.setText(String.valueOf(parent.getItemAtPosition(position)));
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
            }
        });
        group.addView(spinner, fullParams());
        group.addView(target, fullParams());
        LinearLayout actions = wrapRow();
        actions.addView(button("添加" + title, v -> {
            String value = textOf(target);
            if (TextUtils.isEmpty(value)) {
                toast("请输入" + title);
                return;
            }
            if (route) repository.addRoute(value);
            else repository.addPlate(value);
            toast(title + "已添加");
            showHome();
        }));
        actions.addView(button("删除所选" + title, v -> {
            Object selected = spinner.getSelectedItem();
            if (selected == null || spinner.getSelectedItemPosition() <= 0) {
                toast("请选择" + title);
                return;
            }
            confirm("确认删除", "确定删除“" + selected + "”？历史记录不会被删除。", () -> {
                if (route) repository.deleteRoute(String.valueOf(selected));
                else repository.deletePlate(String.valueOf(selected));
                showHome();
            });
        }));
        group.addView(actions);
        form.addView(group, fullParams());
    }

    private LinearLayout summaryCard(Stats stats) {
        LinearLayout card = card();
        card.addView(label("汇总 · " + stats.recordCount + "条", 16, text, true));
        LinearLayout row1 = wrapRow();
        row1.addView(metric("物流蓝出", stats.sendBlueOut, primary));
        row1.addView(metric("物流红出", stats.sendRedOut, red));
        row1.addView(metric("蓝出", stats.blueOut, primary));
        row1.addView(metric("蓝入", stats.blueIn, Color.rgb(75, 151, 224)));
        row1.addView(metric("红出", stats.redOut, red));
        row1.addView(metric("红入", stats.redIn, Color.rgb(238, 107, 107)));
        card.addView(row1);
        card.addView(label("总发出 " + stats.totalOut() + " · 总收回 " + stats.totalIn(), 13, muted, false));
        return card;
    }

    private TextView metric(String name, int value, int color) {
        TextView view = label(name + "\n" + value, 13, color, true);
        view.setGravity(Gravity.CENTER);
        view.setBackgroundColor(darkMode ? Color.rgb(38, 44, 50) : Color.rgb(239, 244, 250));
        view.setPadding(dp(10), dp(8), dp(10), dp(8));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(96), -2);
        params.setMargins(0, dp(8), dp(8), 0);
        view.setLayoutParams(params);
        return view;
    }

    private LinearLayout dateHeader(String date, Stats stats) {
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setPadding(dp(6), dp(16), dp(6), dp(6));
        header.addView(label(date, 17, text, true));
        header.addView(label("蓝出/入 " + stats.blueOut + "/" + stats.blueIn + "   红出/入 " + stats.redOut + "/" + stats.redIn + "   " + stats.recordCount + "条", 13, muted, false));
        return header;
    }

    private LinearLayout recordCard(Record record) {
        LinearLayout card = card();
        card.addView(label(record.routeName + " · " + record.plateNumber, 16, text, true));
        card.addView(label(record.createTime, 12, muted, false));
        card.addView(label("物流蓝出 " + record.sendBlueOut + "  物流红出 " + record.sendRedOut, 13, muted, false));
        card.addView(label("蓝出/入 " + record.blueOut + "/" + record.blueIn + "   红出/入 " + record.redOut + "/" + record.redIn, 13, muted, false));
        if (!TextUtils.isEmpty(record.remark)) card.addView(label("备注：" + record.remark, 13, muted, false));
        LinearLayout actions = row();
        actions.addView(button("编辑", v -> showEditDialog(record)), weightParams());
        actions.addView(button("删除", v -> confirm("删除记录", "确定删除这条记录？", () -> {
            repository.deleteRecord(record.id);
            toast("已删除");
            showHistory();
        })), weightParams());
        card.addView(actions);
        return card;
    }

    private void showEditDialog(Record source) {
        Record latest = repository.getRecord(source.id);
        if (latest == null) {
            toast("记录不存在");
            showHistory();
            return;
        }
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(18), dp(12), dp(18), dp(4));
        EditText route = input("线路");
        route.setText(latest.routeName);
        EditText plate = input("车牌");
        plate.setText(latest.plateNumber);
        form.addView(field("线路", route));
        form.addView(field("车牌", plate));
        CounterField sendBlue = addCounter(form, "物流蓝框发出", latest.sendBlueOut);
        CounterField sendRed = addCounter(form, "物流红框发出", latest.sendRedOut);
        CounterField blueOut = addCounter(form, "蓝框发出", latest.blueOut);
        CounterField blueIn = addCounter(form, "蓝框收回", latest.blueIn);
        CounterField redOut = addCounter(form, "红框发出", latest.redOut);
        CounterField redIn = addCounter(form, "红框收回", latest.redIn);
        EditText remark = input("备注");
        remark.setText(latest.remark);
        form.addView(field("备注", remark));
        ScrollView scroll = new ScrollView(this);
        scroll.addView(form);
        new AlertDialog.Builder(this)
                .setTitle("编辑记录")
                .setView(scroll)
                .setNegativeButton("取消", null)
                .setPositiveButton("保存", (dialog, which) -> {
                    Record updates = new Record();
                    updates.routeName = textOf(route);
                    updates.plateNumber = textOf(plate);
                    updates.sendBlueOut = sendBlue.value();
                    updates.sendRedOut = sendRed.value();
                    updates.blueOut = blueOut.value();
                    updates.blueIn = blueIn.value();
                    updates.redOut = redOut.value();
                    updates.redIn = redIn.value();
                    updates.remark = textOf(remark);
                    if (TextUtils.isEmpty(updates.routeName) || TextUtils.isEmpty(updates.plateNumber)) {
                        toast("线路和车牌不能为空");
                        return;
                    }
                    repository.updateRecord(latest.id, updates);
                    toast("保存成功");
                    showHistory();
                })
                .show();
    }

    private View trendRow(BucketStat bucket, int max) {
        LinearLayout card = card();
        card.addView(label(bucket.label + " · " + bucket.total(), 15, text, true));
        card.addView(label("蓝出/入 " + bucket.blueOut + "/" + bucket.blueIn + "   红出/入 " + bucket.redOut + "/" + bucket.redIn, 13, muted, false));
        View bar = new View(this);
        bar.setBackgroundColor(primary);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(Math.max(dp(8), dp(260) * bucket.total() / Math.max(1, max)), dp(8));
        params.setMargins(0, dp(8), 0, 0);
        card.addView(bar, params);
        return card;
    }

    private CounterField addCounter(LinearLayout parent, String label) {
        return addCounter(parent, label, 0);
    }

    private CounterField addCounter(LinearLayout parent, String label, int initialValue) {
        LinearLayout group = new LinearLayout(this);
        group.setOrientation(LinearLayout.VERTICAL);
        group.setPadding(0, dp(7), 0, dp(7));
        group.addView(label(label, 14, muted, false));
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        Button minus = button("-");
        Button plus = button("+");
        EditText value = new EditText(this);
        value.setText(String.valueOf(initialValue));
        value.setInputType(InputType.TYPE_CLASS_NUMBER);
        value.setGravity(Gravity.CENTER);
        value.setTextColor(text);
        value.setSingleLine(true);
        value.setBackgroundColor(darkMode ? Color.rgb(34, 39, 45) : Color.WHITE);
        minus.setOnClickListener(v -> value.setText(String.valueOf(Math.max(0, parseInt(textOf(value)) - 1))));
        plus.setOnClickListener(v -> value.setText(String.valueOf(parseInt(textOf(value)) + 1)));
        row.addView(minus, new LinearLayout.LayoutParams(dp(54), dp(48)));
        row.addView(value, new LinearLayout.LayoutParams(0, dp(48), 1));
        row.addView(plus, new LinearLayout.LayoutParams(dp(54), dp(48)));
        group.addView(row);
        parent.addView(group, fullParams());
        return new CounterField(value);
    }

    private void exportRecords(List<Record> records) {
        if (records == null || records.isEmpty()) {
            toast("暂无记录可导出");
            return;
        }
        String fileName = "records_" + DateUtils.today().replace("-", "") + ".csv";
        createDocument(fileName, "text/csv", ExportUtils.recordsToCsv(records), "CSV 已导出");
    }

    private void exportBackup() {
        try {
            createDocument("backup_" + DateUtils.today().replace("-", "") + ".json", "application/json", repository.exportAllData(), "备份已导出");
        } catch (Exception e) {
            toast("生成备份失败");
        }
    }

    private void importBackup() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        startActivityForResult(intent, REQ_IMPORT);
    }

    private void createDocument(String name, String mime, String content, String successToast) {
        pendingFileContent = content;
        pendingExportToast = successToast;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(intent, REQ_EXPORT);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        if (requestCode == REQ_EXPORT) {
            try (OutputStream output = getContentResolver().openOutputStream(uri)) {
                if (output != null) {
                    output.write(pendingFileContent.getBytes(StandardCharsets.UTF_8));
                    toast(TextUtils.isEmpty(pendingExportToast) ? "导出成功" : pendingExportToast);
                }
            } catch (Exception e) {
                toast("写入文件失败");
            }
        } else if (requestCode == REQ_IMPORT) {
            try {
                String json = readText(uri);
                int count = repository.importAllData(json);
                toast("已导入 " + count + " 条记录");
                showHistory();
            } catch (Exception e) {
                toast("导入失败：" + e.getMessage());
            }
        }
    }

    private String readText(Uri uri) throws Exception {
        try (InputStream input = getContentResolver().openInputStream(uri);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IllegalStateException("无法读取文件");
            byte[] buffer = new byte[4096];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            return output.toString("UTF-8");
        }
    }

    private void confirmClear() {
        confirm("清空全部数据", "此操作会删除本机所有记录和线路/车牌字典，确定继续？", () -> {
            repository.clearAll();
            toast("已清空");
            showSettings();
        });
    }

    private void pickDate(String initial, DateCallback callback) {
        Calendar calendar = Calendar.getInstance();
        calendar.setTime(DateUtils.parseDate(initial));
        new DatePickerDialog(
                this,
                (view, year, month, dayOfMonth) -> callback.onSelected(String.format(Locale.CHINA, "%04d-%02d-%02d", year, month + 1, dayOfMonth)),
                calendar.get(Calendar.YEAR),
                calendar.get(Calendar.MONTH),
                calendar.get(Calendar.DAY_OF_MONTH)
        ).show();
    }

    private void pickMonth() {
        pickDate(selectedMonth + "-01", value -> {
            selectedMonth = value.substring(0, 7);
            showStats();
        });
    }

    private void pickYear() {
        EditText input = input("年份");
        input.setInputType(InputType.TYPE_CLASS_NUMBER);
        input.setText(selectedYear);
        new AlertDialog.Builder(this)
                .setTitle("选择年份")
                .setView(input)
                .setNegativeButton("取消", null)
                .setPositiveButton("确定", (dialog, which) -> {
                    String value = textOf(input);
                    if (value.length() == 4) {
                        selectedYear = value;
                        showStats();
                    } else {
                        toast("请输入四位年份");
                    }
                })
                .show();
    }

    private String currentPeriod() {
        return "month".equals(statTab) ? selectedMonth : selectedYear;
    }

    private String defaultDate(String value) {
        return TextUtils.isEmpty(value) ? DateUtils.today() : value;
    }

    private Spinner spinner(List<String> values) {
        Spinner spinner = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, values);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinner.setAdapter(adapter);
        return spinner;
    }

    private List<String> withPlaceholder(List<String> values, String placeholder) {
        List<String> result = new ArrayList<>();
        result.add(placeholder);
        result.addAll(values);
        return result;
    }

    private List<String> withAll(List<String> values) {
        List<String> result = new ArrayList<>();
        result.add("全部线路");
        result.addAll(values);
        return result;
    }

    private int routeIndex(Spinner spinner, String route) {
        for (int i = 0; i < spinner.getCount(); i++) {
            String item = String.valueOf(spinner.getItemAtPosition(i));
            if (TextUtils.isEmpty(route) && "全部线路".equals(item)) return i;
            if (item.equals(route)) return i;
        }
        return 0;
    }

    private LinearLayout page() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(14), dp(14), dp(14), dp(20));
        page.setBackgroundColor(bg);
        return page;
    }

    private void setPage(LinearLayout page) {
        ScrollView scrollView = new ScrollView(this);
        scrollView.setFillViewport(false);
        scrollView.addView(page);
        contentFrame.removeAllViews();
        contentFrame.addView(scrollView, new FrameLayout.LayoutParams(-1, -1));
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(12), dp(14), dp(12));
        card.setBackgroundColor(surface);
        LinearLayout.LayoutParams params = fullParams();
        params.setMargins(0, dp(8), 0, dp(8));
        card.setLayoutParams(params);
        return card;
    }

    private LinearLayout emptyCard(String message) {
        LinearLayout card = card();
        TextView textView = label(message, 14, muted, false);
        textView.setGravity(Gravity.CENTER);
        card.addView(textView, fullParams());
        return card;
    }

    private TextView sectionTitle(String value) {
        TextView title = label(value, 18, text, true);
        title.setPadding(dp(4), dp(12), dp(4), dp(4));
        return title;
    }

    private LinearLayout field(String title, View input) {
        LinearLayout group = new LinearLayout(this);
        group.setOrientation(LinearLayout.VERTICAL);
        group.setPadding(0, dp(7), 0, dp(7));
        group.addView(label(title, 14, muted, false));
        group.addView(input, fullParams());
        return group;
    }

    private EditText input(String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setSingleLine(false);
        input.setTextColor(text);
        input.setHintTextColor(muted);
        input.setMinHeight(dp(46));
        input.setPadding(dp(10), 0, dp(10), 0);
        input.setBackgroundColor(darkMode ? Color.rgb(34, 39, 45) : Color.WHITE);
        return input;
    }

    private Button button(String title) {
        Button button = new Button(this);
        button.setText(title);
        button.setAllCaps(false);
        button.setTextSize(14);
        button.setTextColor(primary);
        button.setBackgroundColor(darkMode ? Color.rgb(34, 39, 45) : Color.rgb(239, 244, 250));
        button.setMinHeight(dp(44));
        return button;
    }

    private Button button(String title, View.OnClickListener listener) {
        Button button = button(title);
        button.setOnClickListener(listener);
        return button;
    }

    private TextView label(String value, int sp, int color, boolean bold) {
        TextView textView = new TextView(this);
        textView.setText(value);
        textView.setTextSize(sp);
        textView.setTextColor(color);
        textView.setLineSpacing(dp(2), 1f);
        if (bold) textView.setTypeface(textView.getTypeface(), 1);
        return textView;
    }

    private LinearLayout row() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        return row;
    }

    private LinearLayout wrapRow() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(4), 0, dp(4));
        return row;
    }

    private LinearLayout.LayoutParams fullParams() {
        return new LinearLayout.LayoutParams(-1, -2);
    }

    private LinearLayout.LayoutParams weightParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, -2, 1);
        params.setMargins(dp(3), dp(3), dp(3), dp(3));
        return params;
    }

    private String textOf(EditText editText) {
        return editText.getText() == null ? "" : editText.getText().toString().trim();
    }

    private int parseInt(String value) {
        try {
            return Math.max(0, Integer.parseInt(value));
        } catch (Exception ignored) {
            return 0;
        }
    }

    private void confirm(String title, String message, Runnable onConfirm) {
        new AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(message)
                .setNegativeButton("取消", null)
                .setPositiveButton("确定", (dialog, which) -> onConfirm.run())
                .show();
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private void applyPalette() {
        primary = Color.rgb(25, 118, 210);
        red = Color.rgb(211, 47, 47);
        bg = darkMode ? Color.rgb(21, 25, 30) : Color.rgb(245, 247, 250);
        surface = darkMode ? Color.rgb(29, 34, 40) : Color.WHITE;
        text = darkMode ? Color.rgb(238, 242, 247) : Color.rgb(38, 50, 56);
        muted = darkMode ? Color.rgb(170, 181, 193) : Color.rgb(94, 104, 115);
        stroke = darkMode ? Color.rgb(60, 68, 76) : Color.rgb(222, 228, 235);
        Window window = getWindow();
        window.setStatusBarColor(primary);
        window.setNavigationBarColor(surface);
    }

    private interface DateCallback {
        void onSelected(String value);
    }

    private static class CounterField {
        private final EditText input;

        CounterField(EditText input) {
            this.input = input;
        }

        int value() {
            try {
                return Math.max(0, Integer.parseInt(input.getText().toString().trim()));
            } catch (Exception ignored) {
                return 0;
            }
        }
    }
}
