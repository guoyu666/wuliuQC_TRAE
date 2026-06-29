package com.wuliuqc.app.model;

public class Stats {
    public int sendBlueOut;
    public int sendRedOut;
    public int blueOut;
    public int blueIn;
    public int redOut;
    public int redIn;
    public int recordCount;

    public int totalOut() {
        return blueOut + redOut;
    }

    public int totalIn() {
        return blueIn + redIn;
    }

    public int grandTotal() {
        return sendBlueOut + sendRedOut + blueOut + blueIn + redOut + redIn;
    }
}
