package com.wuliuqc.app.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.util.AttributeSet;
import android.view.View;

import com.wuliuqc.app.model.Stats;

public class ChartView extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private Stats stats = new Stats();
    private int textColor = Color.rgb(38, 50, 56);

    public ChartView(Context context) {
        super(context);
        setMinimumHeight(dp(180));
    }

    public ChartView(Context context, AttributeSet attrs) {
        super(context, attrs);
        setMinimumHeight(dp(180));
    }

    public void setStats(Stats stats, int textColor) {
        this.stats = stats == null ? new Stats() : stats;
        this.textColor = textColor;
        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int width = getWidth();
        int height = getHeight();
        int baseline = height - dp(34);
        int chartTop = dp(16);
        int chartHeight = Math.max(1, baseline - chartTop);
        int[] values = {stats.blueOut, stats.blueIn, stats.redOut, stats.redIn};
        String[] labels = {"蓝出", "蓝入", "红出", "红入"};
        int[] colors = {
                Color.rgb(25, 118, 210),
                Color.rgb(75, 151, 224),
                Color.rgb(211, 47, 47),
                Color.rgb(238, 107, 107)
        };
        int max = 1;
        for (int value : values) {
            max = Math.max(max, value);
        }
        int slot = Math.max(1, width / values.length);
        int barWidth = Math.min(dp(42), Math.max(dp(22), slot / 2));

        paint.setStrokeWidth(dp(1));
        paint.setColor(Color.argb(55, Color.red(textColor), Color.green(textColor), Color.blue(textColor)));
        canvas.drawLine(dp(12), baseline, width - dp(12), baseline, paint);

        paint.setTextAlign(Paint.Align.CENTER);
        paint.setTextSize(dp(12));
        for (int i = 0; i < values.length; i++) {
            int centerX = slot * i + slot / 2;
            int barHeight = Math.max(dp(4), values[i] * chartHeight / max);
            int left = centerX - barWidth / 2;
            int top = baseline - barHeight;
            paint.setColor(colors[i]);
            canvas.drawRoundRect(left, top, left + barWidth, baseline, dp(6), dp(6), paint);
            paint.setColor(textColor);
            canvas.drawText(String.valueOf(values[i]), centerX, top - dp(5), paint);
            canvas.drawText(labels[i], centerX, height - dp(10), paint);
        }
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }
}
