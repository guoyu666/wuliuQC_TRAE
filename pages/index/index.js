const util = require('../../utils/util.js')
const db = require('../../utils/db.js')
const feedback = require('../../utils/feedback.js')
const theme = require('../../utils/theme.js')
const recordUtils = require('../../utils/records.js')
const requestGate = require('../../utils/requestGate.js')

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
    routeSummaryList: [],
    isDarkTheme: false,
    onlineCount: 0,
    onlineActiveWindowSeconds: 0,
    onlineStatusReady: false
  },

  onLoad() {
    if (!db.hasAuthorizedLogin()) {
      wx.redirectTo({ url: '/pages/welcome/welcome' })
      return
    }

    this.skipNextShowReload = true
    this.setData({ isDarkTheme: theme.isDark })
    
    const today = new Date()
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
    
    this.setData({
      selectedDate: util.formatDate(today),
      today: util.formatDate(today),
      monthStart: util.formatDate(monthStart),
      quickType: 'today',
      routeList: db.getRoutes(),
      plateList: db.getPlates()
    }, () => {
      this.setupSyncRefresh()
      this.setupPresenceRefresh()
      this.refreshOnlinePresence()
      this.loadData()
    })
  },

  onShow() {
    if (!db.hasAuthorizedLogin()) {
      wx.redirectTo({ url: '/pages/welcome/welcome' })
      return
    }

    this.refreshPickerOptions()
    this.refreshOnlinePresence()
    if (this.skipNextShowReload) {
      this.skipNextShowReload = false
      return
    }
    this.refreshDictionariesIfNeeded()
    this.loadData()
  },

  onUnload() {
    this.clearDateSwitchTimer()
    if (this.unsubscribeSyncReady) {
      this.unsubscribeSyncReady()
      this.unsubscribeSyncReady = null
    }
    if (this.unsubscribePresence) {
      this.unsubscribePresence()
      this.unsubscribePresence = null
    }
  },

  setupSyncRefresh() {
    const app = getApp()
    if (!app || !app.onSyncReady || this.unsubscribeSyncReady) return

    this.unsubscribeSyncReady = app.onSyncReady(() => {
      this.refreshPickerOptions()
      this.refreshOnlinePresence()
      this.loadData()
    })
  },

  setupPresenceRefresh() {
    const app = getApp()
    if (!app || !app.onPresenceUpdate || this.unsubscribePresence) return
    this.unsubscribePresence = app.onPresenceUpdate(result => {
      this.applyOnlinePresence(result)
    })
  },

  refreshOnlinePresence() {
    const app = getApp()
    const request = app && app.refreshPresence
      ? app.refreshPresence()
      : db.refreshOnlinePresence()
    return request.then(result => this.applyOnlinePresence(result))
  },

  applyOnlinePresence(result) {
    if (!result || !result.success) return result
    this.setData({
      onlineCount: result.onlineCount,
      onlineActiveWindowSeconds: result.activeWindowSeconds,
      onlineStatusReady: true
    })
    return result
  },

  refreshPickerOptions() {
    const routeList = db.getRoutes()
    const plateList = db.getPlates()
    const routeIndex = routeList.indexOf(this.data.routeName)
    const plateIndex = plateList.indexOf(this.data.plateNumber)

    this.setData({
      isDarkTheme: theme.isDark,
      routeList,
      plateList,
      routeIndex,
      plateIndex
    })
  },

  refreshDictionariesIfNeeded(force = false) {
    const now = Date.now()
    if (!force && this.lastDictionaryRefreshAt && now - this.lastDictionaryRefreshAt < 60 * 1000) {
      return Promise.resolve()
    }

    this.lastDictionaryRefreshAt = now
    return db.refreshDictionariesFromCloud().then(() => {
      this.refreshPickerOptions()
    })
  },

  clearDateSwitchTimer() {
    if (this.dateSwitchTimer) {
      clearTimeout(this.dateSwitchTimer)
      this.dateSwitchTimer = null
    }
  },

  getResetEntryFields() {
    return {
      routeName: '',
      plateNumber: '',
      blueOut: 0,
      blueIn: 0,
      redOut: 0,
      redIn: 0,
      remark: '',
      sendBlueOut: 0,
      sendRedOut: 0
    }
  },

  switchDateWithAnimation(getNextState, afterSet) {
    this.clearDateSwitchTimer()
    this.animateBars()
    this.dateSwitchTimer = setTimeout(() => {
      this.dateSwitchTimer = null
      this.setData({
        ...this.getResetEntryFields(),
        ...getNextState()
      }, () => {
        if (afterSet) {
          afterSet()
        }
        this.loadData()
        this.animateBarsIn()
      })
    }, 400)
  },

  loadData() {
    const { selectedDate } = this.data
    const requestId = requestGate.next(this, 'loadData')

    db.getAllRecords().then(allRecords => {
      if (!requestGate.isCurrent(this, 'loadData', requestId)) return

      const dayRecords = recordUtils.filterRecords(allRecords, {
        startDate: selectedDate,
        endDate: selectedDate
      })
      const stats = recordUtils.calculateStats(dayRecords)
      const routeSummaryList = recordUtils.groupRouteSummary(dayRecords)
      
      const maxValue = Math.max(stats.blueOut, stats.blueIn, stats.redOut, stats.redIn, 1)
      const maxHeight = 160

      const barBlueOut = Math.max(4, (stats.blueOut / maxValue) * maxHeight)
      const barBlueIn = Math.max(4, (stats.blueIn / maxValue) * maxHeight)
      const barRedOut = Math.max(4, (stats.redOut / maxValue) * maxHeight)
      const barRedIn = Math.max(4, (stats.redIn / maxValue) * maxHeight)
      
      this.setData({
        todayBlueOut: stats.blueOut,
        todayBlueIn: stats.blueIn,
        todayRedOut: stats.redOut,
        todayRedIn: stats.redIn,
        todayRecordCount: dayRecords.length,
        barBlueOut,
        barBlueIn,
        barRedOut,
        barRedIn,
        routeSummaryList
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
      const selected = util.parseDate(selectedDate)
      const todayDate = util.parseDate(today)
      if (!selected || !todayDate) {
        this.setData({ quickType: '' })
        return
      }
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
    this.switchDateWithAnimation(() => ({ selectedDate }), () => {
      this.updateQuickType()
    })
  },

  goToToday() {
    this.switchDateWithAnimation(() => ({
      selectedDate: this.data.today,
      quickType: 'today'
    }))
  },

  goToYesterday() {
    const baseDate = this.data.selectedDate
    this.switchDateWithAnimation(() => {
      const currentDate = util.parseDate(baseDate) || new Date()
      currentDate.setDate(currentDate.getDate() - 1)
      const yesterdayDate = util.formatDate(currentDate)

      return {
        selectedDate: yesterdayDate,
        quickType: 'yesterday'
      }
    })
  },

  goToLastWeek() {
    const baseDate = this.data.selectedDate
    this.switchDateWithAnimation(() => {
      const currentDate = util.parseDate(baseDate) || new Date()
      currentDate.setDate(currentDate.getDate() - 7)
      const lastWeekDate = util.formatDate(currentDate)

      return {
        selectedDate: lastWeekDate,
        quickType: 'lastWeek'
      }
    })
  },

  goToMonthStart() {
    const baseDate = this.data.selectedDate
    this.switchDateWithAnimation(() => {
      const currentDate = util.parseDate(baseDate) || new Date()
      const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
      const monthStartDate = util.formatDate(monthStart)

      return {
        selectedDate: monthStartDate,
        quickType: 'monthStart'
      }
    })
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
    this.setData({ blueOut: util.normalizeCountInput(e.detail.value) })
  },

  onBlueInChange(e) {
    this.setData({ blueIn: util.normalizeCountInput(e.detail.value) })
  },

  onRedOutChange(e) {
    this.setData({ redOut: util.normalizeCountInput(e.detail.value) })
  },

  onRedInChange(e) {
    this.setData({ redIn: util.normalizeCountInput(e.detail.value) })
  },

  onRemarkChange(e) {
    this.setData({ remark: e.detail.value })
  },

  onSendBlueOutChange(e) {
    this.setData({ sendBlueOut: util.normalizeCountInput(e.detail.value) })
  },

  onSendRedOutChange(e) {
    this.setData({ sendRedOut: util.normalizeCountInput(e.detail.value) })
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

    db.addRecord(newRecord).then((result) => {
      if (!result.success) {
        wx.showToast({
          title: result.message || '记录失败',
          icon: 'none'
        })
        return
      }

      this.setData({
        routeName: '',
        plateNumber: '',
        sendBlueOut: 0,
        sendRedOut: 0,
        blueOut: 0,
        blueIn: 0,
        redOut: 0,
        redIn: 0,
        remark: ''
      })
      
      this.loadData()
      
      feedback.success()
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

  toggleTheme() {
    const isDark = theme.toggle()
    this.setData({ isDarkTheme: isDark })
    feedback.light()
  },

  goToStatistics() {
    wx.navigateTo({
      url: '/pages/statistics/statistics'
    })
  }
})
