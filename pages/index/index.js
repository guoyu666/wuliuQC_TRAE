const util = require('../../utils/util.js')
const db = require('../../utils/db.js')

Page({
  data: {
    selectedDate: '',
    today: '',
    monthStart: '',
    quickType: 'today',
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
    barRedIn: 4,
    animationData: null
  },

  onLoad() {
    const today = new Date()
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
    
    this.setData({
      selectedDate: util.formatDate(today),
      today: util.formatDate(today),
      monthStart: util.formatDate(monthStart),
      quickType: 'today'
    })
    this.loadData()
  },

  onShow() {
    this.loadData()
  },

  loadData() {
    const { selectedDate } = this.data
    db.getAllRecords().then(allRecords => {
      const dayRecords = allRecords.filter(r => r.date === selectedDate)
      
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
    })
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

  updateQuickType() {
    const { selectedDate, today, monthStart } = this.data
    
    if (selectedDate === today) {
      this.setData({ quickType: 'today' })
    } else {
      const selected = new Date(selectedDate)
      const todayDate = new Date(today)
      const diffDays = Math.floor((todayDate - selected) / (1000 * 60 * 60 * 24))
      
      if (diffDays === 1) {
        this.setData({ quickType: 'yesterday' })
      } else if (diffDays >= 7 && diffDays <= 13) {
        this.setData({ quickType: 'lastWeek' })
      } else {
        const currentMonth = selectedDate.substring(0, 7)
        if (selectedDate === currentMonth + '-01') {
          this.setData({ quickType: 'monthStart' })
        } else {
          this.setData({ quickType: '' })
        }
      }
    }
  },

  onDateChange(e) {
    const selectedDate = e.detail.value
    this.animateBars()
    setTimeout(() => {
      this.setData({
        selectedDate,
        blueOut: 0,
        blueIn: 0,
        redOut: 0,
        redIn: 0,
        remark: ''
      }, () => {
        this.updateQuickType()
        this.loadData()
        this.animateBarsIn()
      })
    }, 400)
  },

  goToToday() {
    this.animateBars()
    setTimeout(() => {
      this.setData({
        selectedDate: this.data.today,
        quickType: 'today',
        blueOut: 0,
        blueIn: 0,
        redOut: 0,
        redIn: 0,
        remark: ''
      }, () => {
        this.loadData()
        this.animateBarsIn()
      })
    }, 400)
  },

  goToYesterday() {
    this.animateBars()
    setTimeout(() => {
      const currentDate = new Date(this.data.selectedDate)
      currentDate.setDate(currentDate.getDate() - 1)
      const yesterdayDate = util.formatDate(currentDate)
      
      this.setData({
        selectedDate: yesterdayDate,
        quickType: 'yesterday',
        blueOut: 0,
        blueIn: 0,
        redOut: 0,
        redIn: 0,
        remark: ''
      }, () => {
        this.loadData()
        this.animateBarsIn()
      })
    }, 400)
  },

  goToLastWeek() {
    this.animateBars()
    setTimeout(() => {
      const currentDate = new Date(this.data.selectedDate)
      currentDate.setDate(currentDate.getDate() - 7)
      const lastWeekDate = util.formatDate(currentDate)
      
      this.setData({
        selectedDate: lastWeekDate,
        quickType: 'lastWeek',
        blueOut: 0,
        blueIn: 0,
        redOut: 0,
        redIn: 0,
        remark: ''
      }, () => {
        this.loadData()
        this.animateBarsIn()
      })
    }, 400)
  },

  goToMonthStart() {
    this.animateBars()
    setTimeout(() => {
      const currentDate = new Date(this.data.selectedDate)
      const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
      const monthStartDate = util.formatDate(monthStart)
      
      this.setData({
        selectedDate: monthStartDate,
        quickType: 'monthStart',
        blueOut: 0,
        blueIn: 0,
        redOut: 0,
        redIn: 0,
        remark: ''
      }, () => {
        this.loadData()
        this.animateBarsIn()
      })
    }, 400)
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
    db.getAllRecords().then(allRecords => {
      const dayRecords = allRecords.filter(r => r.date === selectedDate)
      
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
    })
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
      date: selectedDate,
      blueOut,
      blueIn,
      redOut,
      redIn,
      remark: remark.trim()
    }

    db.addRecord(newRecord).then(() => {
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
    })
  },

  goToHistory() {
    wx.navigateTo({
      url: '/pages/history/history'
    })
  },

  goToStatistics() {
    wx.navigateTo({
      url: '/pages/statistics/statistics'
    })
  }
})
