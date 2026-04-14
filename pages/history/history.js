const util = require('../../utils/util.js')
const db = require('../../utils/db.js')

Page({
  data: {
    records: [],
    groupedRecords: [],
    displayGroupedRecords: [],
    showExportModal: false,
    showDataModal: false,
    showRemarkModal: false,
    editRecordId: '',
    editRouteName: '',
    editPlateNumber: '',
    editSendBlueOut: 0,
    editSendRedOut: 0,
    editBlueOut: 0,
    editBlueIn: 0,
    editRedOut: 0,
    editRedIn: 0,
    editRemark: '',
    startDate: '',
    endDate: '',
    exportRecords: [],
    exportStats: {
      blueOut: 0,
      blueIn: 0,
      redOut: 0,
      redIn: 0
    },
    currentPage: 1,
    pageSize: 10,
    hasMore: true,
    totalCount: 0
  },

  onLoad() {
    this.loadRecords()
  },

  onShow() {
    this.loadRecords()
  },

  onPullDownRefresh() {
    this.loadRecords()
    wx.stopPullDownRefresh()
  },

  onReachBottom() {
    this.loadMore()
  },

  loadRecords() {
    db.getAllRecords().then(sortedRecords => {
      const grouped = this.groupByDate(sortedRecords)
      const displayGroupedRecords = grouped.slice(0, this.data.pageSize)
      const hasMore = grouped.length > this.data.pageSize

      this.setData({
        records: sortedRecords,
        groupedRecords: grouped,
        currentPage: 1,
        hasMore: hasMore,
        displayGroupedRecords: displayGroupedRecords,
        totalCount: grouped.length
      })
    })
  },

  loadMore() {
    const { groupedRecords, currentPage, pageSize, hasMore } = this.data

    if (!hasMore) return

    const nextPage = currentPage + 1
    const startIndex = (nextPage - 1) * pageSize
    const endIndex = nextPage * pageSize
    const newGroups = groupedRecords.slice(startIndex, endIndex)

    if (newGroups.length === 0) {
      this.setData({ hasMore: false })
      return
    }

    const displayGroupedRecords = this.data.displayGroupedRecords.concat(newGroups)
    const stillHasMore = groupedRecords.length > nextPage * pageSize

    this.setData({
      currentPage: nextPage,
      displayGroupedRecords: displayGroupedRecords,
      hasMore: stillHasMore
    })
  },

  groupByDate(records) {
    const groups = {}

    records.forEach(record => {
      if (!groups[record.date]) {
        groups[record.date] = {
          date: record.date,
          blueOut: 0,
          blueIn: 0,
          redOut: 0,
          redIn: 0,
          records: []
        }
      }
      groups[record.date].blueOut += record.blueOut || 0
      groups[record.date].blueIn += record.blueIn || 0
      groups[record.date].redOut += record.redOut || 0
      groups[record.date].redIn += record.redIn || 0
      groups[record.date].records.push(record)
    })

    return Object.values(groups).sort((a, b) => {
      return new Date(b.date) - new Date(a.date)
    })
  },

  editData(e) {
    const { id } = e.currentTarget.dataset

    db.getRecordById(id).then(record => {
      if (record) {
        this.setData({
          showDataModal: true,
          editRecordId: id,
          editRouteName: record.routeName || '',
          editPlateNumber: record.plateNumber || '',
          editSendBlueOut: record.sendBlueOut || 0,
          editSendRedOut: record.sendRedOut || 0,
          editBlueOut: record.blueOut || 0,
          editBlueIn: record.blueIn || 0,
          editRedOut: record.redOut || 0,
          editRedIn: record.redIn || 0
        })
      }
    })
  },

  hideDataModal() {
    this.setData({
      showDataModal: false,
      editRecordId: '',
      editRouteName: '',
      editPlateNumber: '',
      editSendBlueOut: 0,
      editSendRedOut: 0,
      editBlueOut: 0,
      editBlueIn: 0,
      editRedOut: 0,
      editRedIn: 0
    })
  },

  onEditRouteNameChange(e) {
    this.setData({ editRouteName: e.detail.value })
  },

  onEditPlateNumberChange(e) {
    this.setData({ editPlateNumber: e.detail.value })
  },

  onEditSendBlueOutChange(e) {
    this.setData({ editSendBlueOut: parseInt(e.detail.value) || 0 })
  },

  onEditSendRedOutChange(e) {
    this.setData({ editSendRedOut: parseInt(e.detail.value) || 0 })
  },

  onEditBlueOutChange(e) {
    this.setData({ editBlueOut: parseInt(e.detail.value) || 0 })
  },

  onEditBlueInChange(e) {
    this.setData({ editBlueIn: parseInt(e.detail.value) || 0 })
  },

  onEditRedOutChange(e) {
    this.setData({ editRedOut: parseInt(e.detail.value) || 0 })
  },

  onEditRedInChange(e) {
    this.setData({ editRedIn: parseInt(e.detail.value) || 0 })
  },

  adjustEditValue(e) {
    const field = e.currentTarget.dataset.field
    const delta = parseInt(e.currentTarget.dataset.delta)
    const currentValue = this.data[field]
    const newValue = Math.max(0, currentValue + delta)
    this.setData({ [field]: newValue })
  },

  saveData() {
    const { editRecordId, editRouteName, editPlateNumber, editSendBlueOut, editSendRedOut, editBlueOut, editBlueIn, editRedOut, editRedIn } = this.data

    db.updateRecord(editRecordId, {
      routeName: editRouteName.trim(),
      plateNumber: editPlateNumber.trim(),
      sendBlueOut: editSendBlueOut,
      sendRedOut: editSendRedOut,
      blueOut: editBlueOut,
      blueIn: editBlueIn,
      redOut: editRedOut,
      redIn: editRedIn
    }).then(() => {
      this.hideDataModal()
      this.loadRecords()
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      })
    })
  },

  editRemark(e) {
    const { id, remark } = e.currentTarget.dataset
    this.setData({
      showRemarkModal: true,
      editRecordId: id,
      editRemark: remark || ''
    })
  },

  hideRemarkModal() {
    this.setData({
      showRemarkModal: false,
      editRecordId: '',
      editRemark: ''
    })
  },

  onEditRemarkChange(e) {
    this.setData({ editRemark: e.detail.value })
  },

  saveRemark() {
    const { editRecordId, editRemark } = this.data

    db.updateRecord(editRecordId, { remark: editRemark.trim() }).then(() => {
      this.hideRemarkModal()
      this.loadRecords()
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      })
    })
  },

  showExportModal() {
    const records = this.data.records
    if (records.length === 0) {
      wx.showToast({
        title: '暂无记录可导出',
        icon: 'none'
      })
      return
    }

    const dates = records.map(r => r.date).sort()
    this.setData({
      showExportModal: true,
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      exportRecords: records,
      exportStats: util.calculateStats(records)
    })
  },

  hideExportModal() {
    this.setData({
      showExportModal: false,
      startDate: '',
      endDate: '',
      exportRecords: [],
      exportStats: { blueOut: 0, blueIn: 0, redOut: 0, redIn: 0 }
    })
  },

  onStartDateChange(e) {
    const startDate = e.detail.value
    this.setData({ startDate })
    this.filterExportRecords()
  },

  onEndDateChange(e) {
    const endDate = e.detail.value
    this.setData({ endDate })
    this.filterExportRecords()
  },

  filterExportRecords() {
    const { records, startDate, endDate } = this.data
    if (!startDate || !endDate) return

    const filtered = records.filter(r => {
      return r.date >= startDate && r.date <= endDate
    })

    this.setData({
      exportRecords: filtered,
      exportStats: util.calculateStats(filtered)
    })
  },

  exportRecords() {
    const { exportRecords, startDate, endDate, exportStats } = this.data

    if (exportRecords.length === 0) {
      wx.showToast({
        title: '请选择日期范围',
        icon: 'none'
      })
      return
    }

    const grouped = this.groupByDate(exportRecords)
    let content = `框子收发记录导出\n`
    content += `导出时间: ${util.formatTime(new Date())}\n`
    content += `日期范围: ${startDate} 至 ${endDate}\n`
    content += `记录条数: ${exportRecords.length}\n`
    content += `------------------\n`
    content += `汇总: 蓝出${exportStats.blueOut} 蓝入${exportStats.blueIn} 红出${exportStats.redOut} 红入${exportStats.redIn}\n`
    content += `------------------\n\n`

    grouped.forEach(group => {
      content += `[${group.date}]\n`
      group.records.forEach(r => {
        content += `${r.routeName || ''} ${r.plateNumber || ''} ${r.createTime} `
        if (r.blueOut > 0) content += `蓝出:${r.blueOut} `
        if (r.blueIn > 0) content += `蓝入:${r.blueIn} `
        if (r.redOut > 0) content += `红出:${r.redOut} `
        if (r.redIn > 0) content += `红入:${r.redIn} `
        if (r.remark) content += `备注:${r.remark} `
        content += `\n`
      })
      content += `小计: 蓝出${group.blueOut} 蓝入${group.blueIn} 红出${group.redOut} 红入${group.redIn}\n\n`
    })

    wx.setStorageSync('exportData', content)

    wx.showModal({
      title: '导出成功',
      content: '记录已生成，是否分享？',
      confirmText: '分享',
      cancelText: '关闭',
      success: (res) => {
        this.hideExportModal()
        if (res.confirm) {
          this.shareExport()
        }
      }
    })
  },

  shareExport() {
    const content = wx.getStorageSync('exportData') || ''

    wx.showModal({
      title: '导出内容',
      content: content,
      showCancel: false,
      confirmText: '复制',
      success: (res) => {
        if (res.confirm) {
          wx.setClipboardData({
            data: content,
            success: () => {
              wx.showToast({
                title: '已复制到剪贴板',
                icon: 'success'
              })
            }
          })
        }
      }
    })
  },

  deleteRecord(e) {
    const { id } = e.currentTarget.dataset

    wx.showModal({
      title: '确认删除',
      content: '确定要删除这条记录吗？',
      success: (res) => {
        if (res.confirm) {
          db.deleteRecord(id).then(() => {
            this.loadRecords()
            wx.showToast({
              title: '已删除',
              icon: 'success'
            })
          })
        }
      }
    })
  },

  goBack() {
    wx.navigateBack()
  }
})