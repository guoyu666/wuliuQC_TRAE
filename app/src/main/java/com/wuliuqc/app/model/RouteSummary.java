package com.wuliuqc.app.model;

public class RouteSummary {
    public String routeName = "";
    public int sendBlueOut;
    public int sendRedOut;
    public int blueOut;
    public int blueIn;
    public int redOut;
    public int redIn;
    public int recordCount;

    public int volume() {
        return sendBlueOut + sendRedOut + blueOut + blueIn + redOut + redIn;
    }
}
