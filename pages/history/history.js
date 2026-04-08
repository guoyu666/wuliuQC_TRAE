const util = require('../../utils/util.js')

Page({
  data: {
    records: [],
    groupedRecords: [],
    displayGroupedRecords: [],
    showExportModal: false,
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
    const records = wx.getStorageSync('records') || []
    const sortedRecords = records.sort((a, b) => {
      return new Date(b.createTime) - new Date(a.createTime)
    })
    
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
      exportStats: this.calculateStats(records)
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
      exportStats: this.calculateStats(filtered)
    })
  },

  calculateStats(records) {
    let blueOut = 0, blueIn = 0, redOut = 0, redIn = 0
    records.forEach(r => {
      blueOut += r.blueOut || 0
      blueIn += r.blueIn || 0
      redOut += r.redOut || 0
      redIn += r.redIn || 0
    })
    return { blueOut, blueIn, redOut, redIn }
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
        content += `${r.createTime} `
        if (r.blueOut > 0) content += `蓝出:${r.blueOut} `
        if (r.blueIn > 0) content += `蓝入:${r.blueIn} `
        if (r.redOut > 0) content += `红出:${r.redOut} `
        if (r.redIn > 0) content += `红入:${r.redIn} `
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
          const records = wx.getStorageSync('records') || []
          const newRecords = records.filter(r => r.id !== id)
          wx.setStorageSync('records', newRecords)
          this.loadRecords()
          wx.showToast({
            title: '已删除',
            icon: 'success'
          })
        }
      }
    })
  },

  goBack() {
    wx.navigateBack()
  }
})
