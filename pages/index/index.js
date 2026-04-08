const util = require('../../utils/util.js')

Page({
  data: {
    selectedDate: '',
    today: '',
    blueOut: 0,
    blueIn: 0,
    redOut: 0,
    redIn: 0,
    remark: '',
    todayBlueOut: 0,
    todayBlueIn: 0,
    todayRedOut: 0,
    todayRedIn: 0,
    barBlueOut: 4,
    barBlueIn: 4,
    barRedOut: 4,
    barRedIn: 4
  },

  onLoad() {
    const today = util.formatDate(new Date())
    this.setData({
      selectedDate: today,
      today: today
    })
    this.loadData()
  },

  onShow() {
    this.loadData()
  },

  loadData() {
    const { selectedDate } = this.data
    const records = wx.getStorageSync('records') || []
    const dayRecords = records.filter(r => r.date === selectedDate)
    
    let todayBlueOut = 0
    let todayBlueIn = 0
    let todayRedOut = 0
    let todayRedIn = 0
    
    dayRecords.forEach(r => {
      todayBlueOut += r.blueOut || 0
      todayBlueIn += r.blueIn || 0
      todayRedOut += r.redOut || 0
      todayRedIn += r.redIn || 0
    })

    const maxValue = Math.max(todayBlueOut, todayBlueIn, todayRedOut, todayRedIn, 1)
    const maxHeight = 160

    const barBlueOut = Math.max(4, (todayBlueOut / maxValue) * maxHeight)
    const barBlueIn = Math.max(4, (todayBlueIn / maxValue) * maxHeight)
    const barRedOut = Math.max(4, (todayRedOut / maxValue) * maxHeight)
    const barRedIn = Math.max(4, (todayRedIn / maxValue) * maxHeight)
    
    this.setData({
      todayBlueOut,
      todayBlueIn,
      todayRedOut,
      todayRedIn,
      barBlueOut,
      barBlueIn,
      barRedOut,
      barRedIn
    })
  },

  onDateChange(e) {
    const selectedDate = e.detail.value
    this.setData({
      selectedDate,
      blueOut: 0,
      blueIn: 0,
      redOut: 0,
      redIn: 0,
      remark: ''
    })
    this.loadData()
  },

  goToToday() {
    const today = util.formatDate(new Date())
    this.setData({
      selectedDate: today,
      blueOut: 0,
      blueIn: 0,
      redOut: 0,
      redIn: 0,
      remark: ''
    })
    this.loadData()
  },

  onBlueOutChange(e) {
    this.setData({ blueOut: parseInt(e.detail.value) || 0 })
  },

  onBlueInChange(e) {
    this.setData({ blueIn: parseInt(e.detail.value) || 0 })
  },

  onRedOutChange(e) {
    this.setData({ redOut: parseInt(e.detail.value) || 0 })
  },

  onRedInChange(e) {
    this.setData({ redIn: parseInt(e.detail.value) || 0 })
  },

  onRemarkChange(e) {
    this.setData({ remark: e.detail.value })
  },

  adjustValue(e) {
    const field = e.currentTarget.dataset.field
    const delta = parseInt(e.currentTarget.dataset.delta)
    const currentValue = this.data[field]
    const newValue = Math.max(0, currentValue + delta)
    this.setData({ [field]: newValue })
  },

  copyLastRemark() {
    const { selectedDate } = this.data
    const records = wx.getStorageSync('records') || []
    const dayRecords = records.filter(r => r.date === selectedDate)
    
    if (dayRecords.length > 0) {
      const lastRecord = dayRecords[dayRecords.length - 1]
      if (lastRecord.remark) {
        this.setData({ remark: lastRecord.remark })
        wx.showToast({
          title: '已复制上次备注',
          icon: 'none'
        })
      } else {
        wx.showToast({
          title: '上次无备注',
          icon: 'none'
        })
      }
    } else {
      wx.showToast({
        title: '无历史记录',
        icon: 'none'
      })
    }
  },

  submitRecord() {
    const { blueOut, blueIn, redOut, redIn, remark, selectedDate } = this.data
    
    if (blueOut === 0 && blueIn === 0 && redOut === 0 && redIn === 0 && !remark) {
      wx.showToast({
        title: '请输入数量或备注',
        icon: 'none'
      })
      return
    }

    const newRecord = {
      id: Date.now().toString(),
      date: selectedDate,
      blueOut,
      blueIn,
      redOut,
      redIn,
      remark: remark.trim(),
      createTime: util.formatTime(new Date())
    }

    const records = wx.getStorageSync('records') || []
    records.push(newRecord)
    wx.setStorageSync('records', records)
    
    this.setData({
      blueOut: 0,
      blueIn: 0,
      redOut: 0,
      redIn: 0,
      remark: ''
    })
    
    this.loadData()
    
    wx.showToast({
      title: '记录成功',
      icon: 'success'
    })
  },

  goToHistory() {
    wx.navigateTo({
      url: '/pages/history/history'
    })
  },

  goToLogin() {
    wx.navigateTo({
      url: '/pages/login/login'
    })
  }
})
