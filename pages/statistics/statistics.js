const util = require('../../utils/util.js')
const db = require('../../utils/db.js')
const feedback = require('../../utils/feedback.js')
const theme = require('../../utils/theme.js')

Page({
  data: {
    currentTab: 'month',
    selectedMonth: '',
    selectedYear: '',
    routeList: [],
    selectedRoute: '',
    routeIndex: 0,
    isDarkTheme: false,
    totalBlueOut: 0,
    totalBlueIn: 0,
    totalRedOut: 0,
    totalRedIn: 0,
    totalOut: 0,
    totalIn: 0,
    barBlueOut: 0,
    barBlueIn: 0,
    barRedOut: 0,
    barRedIn: 0,
    dailyData: [],
    monthlyData: [],
    maxDaily: 1,
    maxMonthly: 1,
    animationData: null,
    trendAnimationData: null
  },

  onLoad() {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    
    this.setData({
      selectedMonth: `${year}-${month}`,
      selectedYear: year.toString(),
      routeList: ['全部', ...db.getRoutes()],
      isDarkTheme: theme.isDark
    })
    
    this.loadData()
  },

  onShow() {
    this.setData({ isDarkTheme: theme.isDark })
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ currentTab: tab }, () => {
      this.animateBars()
      setTimeout(() => {
        this.loadData()
        this.animateBarsIn()
      }, 400)
    })
  },

  onRouteChange(e) {
    const index = e.detail.value
    const route = this.data.routeList[index]
    this.setData({ 
      selectedRoute: route === '全部' ? '' : route,
      routeIndex: index
    }, () => {
      this.animateBars()
      setTimeout(() => {
        this.loadData()
        this.animateBarsIn()
      }, 200)
    })
  },

  onMonthChange(e) {
    this.animateBars()
    setTimeout(() => {
      this.setData({ selectedMonth: e.detail.value }, () => {
        this.loadData()
        this.animateBarsIn()
      })
    }, 400)
  },

  onYearChange(e) {
    this.animateBars()
    setTimeout(() => {
      this.setData({ selectedYear: e.detail.value }, () => {
        this.loadData()
        this.animateBarsIn()
      })
    }, 400)
  },

  goToPrev() {
    this.animateBars()
    setTimeout(() => {
      if (this.data.currentTab === 'month') {
        const [year, month] = this.data.selectedMonth.split('-')
        const date = new Date(parseInt(year), parseInt(month) - 2, 1)
        const newYear = date.getFullYear()
        const newMonth = String(date.getMonth() + 1).padStart(2, '0')
        this.setData({ selectedMonth: `${newYear}-${newMonth}` }, () => {
          this.loadData()
          this.animateBarsIn()
        })
      } else {
        const newYear = parseInt(this.data.selectedYear) - 1
        this.setData({ selectedYear: newYear.toString() }, () => {
          this.loadData()
          this.animateBarsIn()
        })
      }
    }, 400)
  },

  goToCurrent() {
    this.animateBars()
    setTimeout(() => {
      const now = new Date()
      const year = now.getFullYear()
      const month = String(now.getMonth() + 1).padStart(2, '0')
      
      if (this.data.currentTab === 'month') {
        this.setData({ selectedMonth: `${year}-${month}` }, () => {
          this.loadData()
          this.animateBarsIn()
        })
      } else {
        this.setData({ selectedYear: year.toString() }, () => {
          this.loadData()
          this.animateBarsIn()
        })
      }
    }, 400)
  },

  goToNext() {
    this.animateBars()
    setTimeout(() => {
      if (this.data.currentTab === 'month') {
        const [year, month] = this.data.selectedMonth.split('-')
        const date = new Date(parseInt(year), parseInt(month), 1)
        const newYear = date.getFullYear()
        const newMonth = String(date.getMonth() + 1).padStart(2, '0')
        this.setData({ selectedMonth: `${newYear}-${newMonth}` }, () => {
          this.loadData()
          this.animateBarsIn()
        })
      } else {
        const newYear = parseInt(this.data.selectedYear) + 1
        this.setData({ selectedYear: newYear.toString() }, () => {
          this.loadData()
          this.animateBarsIn()
        })
      }
    }, 400)
  },

  animateBars() {
    const animation = wx.createAnimation({
      duration: 400,
      timingFunction: 'ease-out',
      delay: 0
    })
    
    animation.opacity(0).translateY(15).step()
    
    this.setData({
      animationData: animation.export()
    })
  },

  animateBarsIn() {
    const animation = wx.createAnimation({
      duration: 500,
      timingFunction: 'ease-out',
      delay: 0
    })
    
    animation.opacity(1).translateY(0).step()
    
    this.setData({
      animationData: animation.export()
    })
  },

  loadData() {
    db.getAllRecords().then(records => {
      if (this.data.currentTab === 'month') {
        this.loadMonthData(records)
      } else {
        this.loadYearData(records)
      }
    })
  },

  toggleTheme() {
    const isDark = theme.toggle()
    this.setData({ isDarkTheme: isDark })
    feedback.light()
  },

  loadMonthData(records) {
    const { selectedMonth, selectedRoute } = this.data
    
    let filteredRecords = records.filter(r => {
      return r.date.startsWith(selectedMonth)
    })
    
    if (selectedRoute) {
      filteredRecords = filteredRecords.filter(r => r.routeName === selectedRoute)
    }
    
    let totalBlueOut = 0, totalBlueIn = 0, totalRedOut = 0, totalRedIn = 0
    const dailyMap = {}
    
    filteredRecords.forEach(r => {
      totalBlueOut += r.blueOut || 0
      totalBlueIn += r.blueIn || 0
      totalRedOut += r.redOut || 0
      totalRedIn += r.redIn || 0
      
      if (!dailyMap[r.date]) {
        dailyMap[r.date] = { date: r.date, blueOut: 0, blueIn: 0, redOut: 0, redIn: 0 }
      }
      dailyMap[r.date].blueOut += r.blueOut || 0
      dailyMap[r.date].blueIn += r.blueIn || 0
      dailyMap[r.date].redOut += r.redOut || 0
      dailyMap[r.date].redIn += r.redIn || 0
    })
    
    const dailyData = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date))
    const maxDaily = Math.max(...dailyData.map(d => d.blueOut + d.blueIn + d.redOut + d.redIn), 1)
    
    const totalOut = totalBlueOut + totalRedOut
    const totalIn = totalBlueIn + totalRedIn
    const maxValue = Math.max(totalBlueOut + totalRedOut, totalBlueIn + totalRedIn, 1)
    const maxHeight = 160
    
    this.setData({
      totalBlueOut,
      totalBlueIn,
      totalRedOut,
      totalRedIn,
      totalOut,
      totalIn,
      barBlueOut: Math.max(4, (totalBlueOut / maxValue) * maxHeight),
      barBlueIn: Math.max(4, (totalBlueIn / maxValue) * maxHeight),
      barRedOut: Math.max(4, (totalRedOut / maxValue) * maxHeight),
      barRedIn: Math.max(4, (totalRedIn / maxValue) * maxHeight),
      dailyData,
      maxDaily
    })
  },

  loadYearData(records) {
    const { selectedYear, selectedRoute } = this.data
    
    let filteredRecords = records.filter(r => {
      return r.date.startsWith(selectedYear)
    })
    
    if (selectedRoute) {
      filteredRecords = filteredRecords.filter(r => r.routeName === selectedRoute)
    }
    
    let totalBlueOut = 0, totalBlueIn = 0, totalRedOut = 0, totalRedIn = 0
    const monthlyMap = {}
    
    filteredRecords.forEach(r => {
      totalBlueOut += r.blueOut || 0
      totalBlueIn += r.blueIn || 0
      totalRedOut += r.redOut || 0
      totalRedIn += r.redIn || 0
      
      const month = r.date.substring(5, 7)
      if (!monthlyMap[month]) {
        monthlyMap[month] = { month: parseInt(month), blueOut: 0, blueIn: 0, redOut: 0, redIn: 0 }
      }
      monthlyMap[month].blueOut += r.blueOut || 0
      monthlyMap[month].blueIn += r.blueIn || 0
      monthlyMap[month].redOut += r.redOut || 0
      monthlyMap[month].redIn += r.redIn || 0
    })
    
    const monthlyData = Object.values(monthlyMap).sort((a, b) => a.month - b.month)
    const maxMonthly = Math.max(...monthlyData.map(d => d.blueOut + d.blueIn + d.redOut + d.redIn), 1)
    
    const totalOut = totalBlueOut + totalRedOut
    const totalIn = totalBlueIn + totalRedIn
    const maxValue = Math.max(totalBlueOut + totalRedOut, totalBlueIn + totalRedIn, 1)
    const maxHeight = 160
    
    this.setData({
      totalBlueOut,
      totalBlueIn,
      totalRedOut,
      totalRedIn,
      totalOut,
      totalIn,
      barBlueOut: Math.max(4, (totalBlueOut / maxValue) * maxHeight),
      barBlueIn: Math.max(4, (totalBlueIn / maxValue) * maxHeight),
      barRedOut: Math.max(4, (totalRedOut / maxValue) * maxHeight),
      barRedIn: Math.max(4, (totalRedIn / maxValue) * maxHeight),
      monthlyData,
      maxMonthly
    })
  },

  goBack() {
    wx.navigateBack()
  }
})
