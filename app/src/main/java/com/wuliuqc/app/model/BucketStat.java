package com.wuliuqc.app.model;

public class BucketStat {
    public String label;
    public int blueOut;
    public int blueIn;
    public int redOut;
    public int redIn;

    public BucketStat(String label) {
        this.label = label;
    }

    public int total() {
        return blueOut + blueIn + redOut + redIn;
    }
}
