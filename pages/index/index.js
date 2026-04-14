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
    routeOptions: [],
    plateOptions: [],
    presetRoutes: [],
    presetPlates: [],
    showPresetModal: false,
    newRoute: '',
    newPlate: '',
    selectedRouteIndex: 0,
    selectedPlateIndex: 0
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
    this.loadPresets()
  },

  loadPresets() {
    const presets = db.getPresets()
    this.setData({
      presetRoutes: presets.routes,
      presetPlates: presets.plates,
      routeOptions: presets.routes,
      plateOptions: presets.plates,
      selectedRouteIndex: 0,
      selectedPlateIndex: 0
    })
  },

  loadData() {
    const { selectedDate } = this.data
    db.getAllRecords().then(allRecords => {
      const dayRecords = allRecords.filter(r => r.date === selectedDate)
      const stats = util.calculateStats(dayRecords)
      const barHeights = util.calculateBarHeights(stats)

      this.setData({
        ...stats,
        todayRecordCount: dayRecords.length,
        ...barHeights
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
    const { selectedDate, today } = this.data
    const selected = new Date(selectedDate)
    const todayDate = new Date(today)
    const diffDays = Math.floor((todayDate - selected) / (1000 * 60 * 60 * 24))

    if (selectedDate === today) {
      this.setData({ quickType: 'today' })
    } else if (diffDays === 1) {
      this.setData({ quickType: 'yesterday' })
    } else if (diffDays >= 7 && diffDays <= 13) {
      this.setData({ quickType: 'lastWeek' })
    } else if (selectedDate === selectedDate.substring(0, 7) + '-01') {
      this.setData({ quickType: 'monthStart' })
    } else {
      this.setData({ quickType: '' })
    }
  },

  clearFormAndLoad(date, quickType) {
    this.animateBars()
    setTimeout(() => {
      this.setData({
        selectedDate: date,
        quickType,
        routeName: '',
        plateNumber: '',
        blueOut: 0,
        blueIn: 0,
        redOut: 0,
        redIn: 0,
        remark: '',
        selectedRouteIndex: 0,
        selectedPlateIndex: 0
      }, () => {
        this.loadData()
        this.animateBarsIn()
      })
    }, 400)
  },

  onDateChange(e) {
    const selectedDate = e.detail.value
    this.updateQuickType()
    this.clearFormAndLoad(selectedDate, '')
  },

  goToToday() {
    this.clearFormAndLoad(this.data.today, 'today')
  },

  goToYesterday() {
    const currentDate = new Date(this.data.selectedDate)
    currentDate.setDate(currentDate.getDate() - 1)
    this.clearFormAndLoad(util.formatDate(currentDate), 'yesterday')
  },

  goToLastWeek() {
    const currentDate = new Date(this.data.selectedDate)
    currentDate.setDate(currentDate.getDate() - 7)
    this.clearFormAndLoad(util.formatDate(currentDate), 'lastWeek')
  },

  goToMonthStart() {
    const currentDate = new Date(this.data.selectedDate)
    const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
    this.clearFormAndLoad(util.formatDate(monthStart), 'monthStart')
  },

  onRouteNameChange(e) {
    this.setData({ routeName: e.detail.value })
  },

  onPlateNumberChange(e) {
    this.setData({ plateNumber: e.detail.value })
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

  onRouteChange(e) {
    const index = parseInt(e.detail.value)
    const route = this.data.routeOptions[index]
    this.setData({
      routeName: route || '',
      selectedRouteIndex: index
    })
  },

  onPlateChange(e) {
    const index = parseInt(e.detail.value)
    const plate = this.data.plateOptions[index]
    this.setData({
      plateNumber: plate || '',
      selectedPlateIndex: index
    })
  },

  showPresetModal() {
    this.loadPresets()
    this.setData({ showPresetModal: true })
  },

  hidePresetModal() {
    this.setData({ showPresetModal: false })
  },

  onNewRouteChange(e) {
    this.setData({ newRoute: e.detail.value })
  },

  onNewPlateChange(e) {
    this.setData({ newPlate: e.detail.value })
  },

  addPresetRoute() {
    const { newRoute } = this.data
    if (!newRoute.trim()) {
      wx.showToast({ title: '请输入线路名称', icon: 'none' })
      return
    }
    const routes = db.addRoute(newRoute.trim())
    this.setData({
      presetRoutes: routes,
      routeOptions: routes,
      newRoute: ''
    })
    wx.showToast({ title: '已添加', icon: 'success' })
  },

  addPresetPlate() {
    const { newPlate } = this.data
    if (!newPlate.trim()) {
      wx.showToast({ title: '请输入车牌号', icon: 'none' })
      return
    }
    const plates = db.addPlate(newPlate.trim())
    this.setData({
      presetPlates: plates,
      plateOptions: plates,
      newPlate: ''
    })
    wx.showToast({ title: '已添加', icon: 'success' })
  },

  deletePresetRoute(e) {
    const route = e.currentTarget.dataset.route
    const routes = db.deleteRoute(route)
    this.setData({
      presetRoutes: routes,
      routeOptions: routes
    })
    wx.showToast({ title: '已删除', icon: 'success' })
  },

  deletePresetPlate(e) {
    const plate = e.currentTarget.dataset.plate
    const plates = db.deletePlate(plate)
    this.setData({
      presetPlates: plates,
      plateOptions: plates
    })
    wx.showToast({ title: '已删除', icon: 'success' })
  },

  submitRecord() {
    const { routeName, plateNumber, blueOut, blueIn, redOut, redIn, remark, selectedDate, sendBlueOut, sendRedOut } = this.data

    if (!routeName.trim()) {
      wx.showToast({ title: '请输入线路名称', icon: 'none' })
      return
    }

    if (!plateNumber.trim()) {
      wx.showToast({ title: '请输入车牌号', icon: 'none' })
      return
    }

    if (blueOut === 0 && blueIn === 0 && redOut === 0 && redIn === 0 && !remark && sendBlueOut === 0 && sendRedOut === 0) {
      wx.showToast({ title: '请输入数量或备注', icon: 'none' })
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
        remark: '',
        selectedRouteIndex: 0,
        selectedPlateIndex: 0
      })

      this.loadData()

      wx.showToast({ title: '记录成功', icon: 'success' })
    })
  },

  goToHistory() {
    wx.navigateTo({ url: '/pages/history/history' })
  },

  goToStatistics() {
    wx.navigateTo({ url: '/pages/statistics/statistics' })
  }
})