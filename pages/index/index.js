const util = require('../../utils/util.js')
const db = require('../../utils/db.js')

Page({
  data: {
    selectedDate: '',
    today: '',
    monthStart: '',
    quickType: 'today',
    routeName: '',
    plateNumber: '',
    routeList: [],
    plateList: [],
    routeIndex: -1,
    plateIndex: -1,
    newRouteName: '',
    newPlateNumber: '',
    blueOut: 0,
    blueIn: 0,
    redOut: 0,
    redIn: 0,
    remark: '',
    sendBlueOut: 0,
    sendRedOut: 0,
    todayBlueOut: 0,
    todayBlueIn: 0,
    todayRedOut: 0,
    todayRedIn: 0,
    todayRecordCount: 0,
    barBlueOut: 4,
    barBlueIn: 4,
    barRedOut: 4,
    barRedIn: 4,
    animationData: null,
    showBlueSection: true,
    showRedSection: true,
    groupedList: [],
    collapsedGroups: {}
  },

  onLoad() {
    const today = new Date()
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
    
    this.setData({
      selectedDate: util.formatDate(today),
      today: util.formatDate(today),
      monthStart: util.formatDate(monthStart),
      quickType: 'today',
      routeList: db.getRoutes(),
      plateList: db.getPlates()
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

      const grouped = {}
      dayRecords.forEach(r => {
        const key = `${r.routeName || '未知'}_${r.plateNumber || '未知'}`
        if (!grouped[key]) {
          grouped[key] = {
            routeName: r.routeName || '未知',
            plateNumber: r.plateNumber || '未知',
            sendBlueOut: 0,
            sendRedOut: 0,
            blueOut: 0,
            blueIn: 0,
            redOut: 0,
            redIn: 0
          }
        }
        grouped[key].sendBlueOut += r.sendBlueOut || 0
        grouped[key].sendRedOut += r.sendRedOut || 0
        grouped[key].blueOut += r.blueOut || 0
        grouped[key].blueIn += r.blueIn || 0
        grouped[key].redOut += r.redOut || 0
        grouped[key].redIn += r.redIn || 0
      })

      const groupedList = Object.values(grouped)
      
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
        todayRecordCount: dayRecords.length,
        barBlueOut,
        barBlueIn,
        barRedOut,
        barRedIn,
        groupedList
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
        routeName: '',
        plateNumber: '',
        blueOut: 0,
        blueIn: 0,
        redOut: 0,
        redIn: 0,
        remark: '',
        sendBlueOut: 0,
        sendRedOut: 0
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
        routeName: '',
        plateNumber: '',
        blueOut: 0,
        blueIn: 0,
        redOut: 0,
        redIn: 0,
        remark: '',
        sendBlueOut: 0,
        sendRedOut: 0
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
        routeName: '',
        plateNumber: '',
        blueOut: 0,
        blueIn: 0,
        redOut: 0,
        redIn: 0,
        remark: '',
        sendBlueOut: 0,
        sendRedOut: 0
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
        routeName: '',
        plateNumber: '',
        blueOut: 0,
        blueIn: 0,
        redOut: 0,
        redIn: 0,
        remark: '',
        sendBlueOut: 0,
        sendRedOut: 0
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
        routeName: '',
        plateNumber: '',
        blueOut: 0,
        blueIn: 0,
        redOut: 0,
        redIn: 0,
        remark: '',
        sendBlueOut: 0,
        sendRedOut: 0
      }, () => {
        this.loadData()
        this.animateBarsIn()
      })
    }, 400)
  },

  onRouteChange(e) {
    const index = e.detail.value
    const routeName = this.data.routeList[index]
    this.setData({
      routeIndex: index,
      routeName: routeName || ''
    })
  },

  onPlateChange(e) {
    const index = e.detail.value
    const plateNumber = this.data.plateList[index]
    this.setData({
      plateIndex: index,
      plateNumber: plateNumber || ''
    })
  },

  onNewRouteNameInput(e) {
    this.setData({ newRouteName: e.detail.value })
  },

  onNewPlateNumberInput(e) {
    this.setData({ newPlateNumber: e.detail.value })
  },

  addNewRoute() {
    const { newRouteName, routeList } = this.data
    if (!newRouteName || !newRouteName.trim()) return
    const trimmed = newRouteName.trim()
    if (!routeList.includes(trimmed)) {
      const updated = db.addRoute(trimmed)
      this.setData({
        routeList: updated,
        routeIndex: updated.length - 1,
        routeName: trimmed,
        newRouteName: ''
      })
    } else {
      this.setData({
        routeIndex: routeList.indexOf(trimmed),
        routeName: trimmed,
        newRouteName: ''
      })
    }
    wx.showToast({
      title: '线路已添加',
      icon: 'success'
    })
  },

  addNewPlate() {
    const { newPlateNumber, plateList } = this.data
    if (!newPlateNumber || !newPlateNumber.trim()) return
    const trimmed = newPlateNumber.trim()
    if (!plateList.includes(trimmed)) {
      const updated = db.addPlate(trimmed)
      this.setData({
        plateList: updated,
        plateIndex: updated.length - 1,
        plateNumber: trimmed,
        newPlateNumber: ''
      })
    } else {
      this.setData({
        plateIndex: plateList.indexOf(trimmed),
        plateNumber: trimmed,
        newPlateNumber: ''
      })
    }
    wx.showToast({
      title: '车牌已添加',
      icon: 'success'
    })
  },

  deleteSelectedRoute() {
    const { routeIndex, routeList } = this.data
    if (routeIndex < 0) return
    const routeName = routeList[routeIndex]
    
    wx.showModal({
      title: '确认删除',
      content: `确定要删除线路"${routeName}"吗？`,
      success: (res) => {
        if (res.confirm) {
          const updated = db.deleteRoute(routeName)
          this.setData({
            routeList: updated,
            routeIndex: -1,
            routeName: ''
          })
          wx.showToast({
            title: '已删除',
            icon: 'success'
          })
        }
      }
    })
  },

  toggleBlueSection() {
    this.setData({ showBlueSection: !this.data.showBlueSection })
  },

  toggleRedSection() {
    this.setData({ showRedSection: !this.data.showRedSection })
  },

  toggleGroup(e) {
    const key = e.currentTarget.dataset.key
    const collapsedGroups = { ...this.data.collapsedGroups }
    collapsedGroups[key] = !collapsedGroups[key]
    this.setData({ collapsedGroups })
  },

  deleteSelectedPlate() {
    const { plateIndex, plateList } = this.data
    if (plateIndex < 0) return
    const plateNumber = plateList[plateIndex]
    
    wx.showModal({
      title: '确认删除',
      content: `确定要删除车牌"${plateNumber}"吗？`,
      success: (res) => {
        if (res.confirm) {
          const updated = db.deletePlate(plateNumber)
          this.setData({
            plateList: updated,
            plateIndex: -1,
            plateNumber: ''
          })
          wx.showToast({
            title: '已删除',
            icon: 'success'
          })
        }
      }
    })
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

  onSendBlueOutChange(e) {
    this.setData({ sendBlueOut: parseInt(e.detail.value) || 0 })
  },

  onSendRedOutChange(e) {
    this.setData({ sendRedOut: parseInt(e.detail.value) || 0 })
  },

  adjustSendValue(e) {
    const field = e.currentTarget.dataset.field
    const delta = parseInt(e.currentTarget.dataset.delta)
    const currentValue = this.data[field]
    const newValue = Math.max(0, currentValue + delta)
    this.setData({ [field]: newValue })
  },

  adjustValue(e) {
    const field = e.currentTarget.dataset.field
    const delta = parseInt(e.currentTarget.dataset.delta)
    const currentValue = this.data[field]
    const newValue = Math.max(0, currentValue + delta)
    this.setData({ [field]: newValue })
  },

  submitRecord() {
    const { routeName, plateNumber, blueOut, blueIn, redOut, redIn, remark, selectedDate, sendBlueOut, sendRedOut } = this.data
    
    if (!routeName.trim()) {
      wx.showToast({
        title: '请输入线路名称',
        icon: 'none'
      })
      return
    }

    if (!plateNumber.trim()) {
      wx.showToast({
        title: '请输入车牌号',
        icon: 'none'
      })
      return
    }
    
    if (blueOut === 0 && blueIn === 0 && redOut === 0 && redIn === 0 && !remark && sendBlueOut === 0 && sendRedOut === 0) {
      wx.showToast({
        title: '请输入数量或备注',
        icon: 'none'
      })
      return
    }

    const newRecord = {
      date: selectedDate,
      routeName: routeName.trim(),
      plateNumber: plateNumber.trim(),
      sendBlueOut,
      sendRedOut,
      blueOut,
      blueIn,
      redOut,
      redIn,
      remark: remark.trim()
    }

    db.addRecord(newRecord).then(() => {
      this.setData({
        routeName: '',
        plateNumber: '',
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