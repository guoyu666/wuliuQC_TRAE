const util = require('../../utils/util.js')
const db = require('../../utils/db.js')
const theme = require('../../utils/theme.js')
const feedback = require('../../utils/feedback.js')

Page({
  data: {
    records: [],
    groupedRecords: [],
    pagingRecords: [],
    displayGroupedRecords: [],
    showExportModal: false,
    showDataModal: false,
    editRecordId: '',
    editRouteName: '',
    editPlateNumber: '',
    editRouteIndex: -1,
    editPlateIndex: -1,
    newEditRouteName: '',
    newEditPlateNumber: '',
    routeList: [],
    plateList: [],
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
    exportSourceRecords: [],
    exportStats: {
      blueOut: 0,
      blueIn: 0,
      redOut: 0,
      redIn: 0
    },
    currentPage: 1,
    pageSize: 10,
    hasMore: true,
    totalCount: 0,
    searchKeyword: '',
    isSearching: false,
    filteredRecordCount: 0,
    showFilter: false,
    filterStartDate: '',
    filterEndDate: '',
    showBackupModal: false,
    swipedRecordId: '',
    touchStartX: 0,
    touchStartY: 0,
    touchRecordId: '',
    syncStatus: null,
    isDarkTheme: false
  },

  onLoad() {
    this.setData({
      routeList: db.getRoutes(),
      plateList: db.getPlates(),
      isDarkTheme: theme.isDark,
      syncStatus: db.getSyncStatus()
    })
    this.loadRecords()
  },

  onShow() {
    this.setData({
      isDarkTheme: theme.isDark,
      syncStatus: db.getSyncStatus()
    })
    this.loadRecords()
  },

  onPullDownRefresh() {
    this.loadRecords(true).finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  onReachBottom() {
    this.loadMore()
  },

  loadRecords(forceRefresh = false) {
    return db.getAllRecords({ forceRefresh }).then(sortedRecords => {
      const { displayGroupedRecords, hasMore } = this.getPagedGroups(sortedRecords, 1)

      this.setData({
        records: sortedRecords,
        pagingRecords: sortedRecords,
        groupedRecords: displayGroupedRecords,
        currentPage: 1,
        hasMore: hasMore,
        displayGroupedRecords: displayGroupedRecords,
        totalCount: sortedRecords.length,
        syncStatus: db.getSyncStatus()
      })
    })
  },

  refreshSyncStatus() {
    this.setData({ syncStatus: db.getSyncStatus() })
  },

  retrySync() {
    if (!db.isLoggedIn()) {
      wx.showToast({ title: '云端未登录，稍后再试', icon: 'none' })
      return
    }

    wx.showLoading({ title: '同步中...' })
    db.syncRecords()
      .then(result => {
        if (result.success) {
          feedback.success()
          wx.showToast({ title: '同步完成', icon: 'success' })
        } else {
          wx.showToast({ title: result.message || '同步失败', icon: 'none' })
        }
      })
      .finally(() => {
        wx.hideLoading()
        this.loadRecords(true).finally(() => {
          this.refreshSyncStatus()
        })
      })
  },

  cancelPendingRestore() {
    wx.showModal({
      title: '取消恢复同步',
      content: '取消后将不再把当前备份覆盖到云端，之后会重新拉取云端数据。确定取消吗？',
      success: (res) => {
        if (res.confirm) {
          db.cancelPendingCloudReplace()
          this.loadRecords(true).finally(() => {
            this.refreshSyncStatus()
          })
        }
      }
    })
  },

  loadMore() {
    const { pagingRecords, currentPage, hasMore } = this.data

    if (!hasMore) return

    const nextPage = currentPage + 1
    const { displayGroupedRecords, hasMore: stillHasMore, loadedCount } = this.getPagedGroups(pagingRecords, nextPage)
    const previousLoadedCount = Math.min(currentPage * this.data.pageSize, pagingRecords.length)

    if (loadedCount <= previousLoadedCount) {
      this.setData({ hasMore: false })
      return
    }

    this.setData({
      currentPage: nextPage,
      displayGroupedRecords: displayGroupedRecords,
      groupedRecords: displayGroupedRecords,
      hasMore: stillHasMore
    })
  },

  getPagedGroups(records, page) {
    const pageSize = this.data.pageSize
    const loadedRecords = records.slice(0, page * pageSize)
    return {
      displayGroupedRecords: this.groupByDate(loadedRecords, records),
      hasMore: records.length > loadedRecords.length,
      loadedCount: loadedRecords.length
    }
  },

  isValidRecordDate(record) {
    return record && typeof record.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.date)
  },

  groupByDate(records, summaryRecords = records) {
    const groups = {}

    records.forEach(record => {
      const date = this.isValidRecordDate(record) ? record.date : '未知日期'
      if (!groups[date]) {
        groups[date] = {
          date,
          blueOut: 0,
          blueIn: 0,
          redOut: 0,
          redIn: 0,
          records: []
        }
      }
      groups[date].records.push(record)
    })

    summaryRecords.forEach(record => {
      const date = this.isValidRecordDate(record) ? record.date : '未知日期'
      if (!groups[date]) return

      groups[date].blueOut += record.blueOut || 0
      groups[date].blueIn += record.blueIn || 0
      groups[date].redOut += record.redOut || 0
      groups[date].redIn += record.redIn || 0
    })

    return Object.values(groups).sort((a, b) => {
      if (a.date === '未知日期') return 1
      if (b.date === '未知日期') return -1
      return b.date.localeCompare(a.date)
    })
  },

  editData(e) {
    const { id } = e.currentTarget.dataset

    db.getRecordById(id).then(record => {
      if (record) {
        const routeList = this.data.routeList
        const plateList = this.data.plateList
        const routeIndex = routeList.indexOf(record.routeName)
        const plateIndex = plateList.indexOf(record.plateNumber)
        
        this.setData({
          showDataModal: true,
          editRecordId: id,
          editRouteName: record.routeName || '',
          editPlateNumber: record.plateNumber || '',
          editRouteIndex: routeIndex >= 0 ? routeIndex : -1,
          editPlateIndex: plateIndex >= 0 ? plateIndex : -1,
          editSendBlueOut: record.sendBlueOut || 0,
          editSendRedOut: record.sendRedOut || 0,
          editBlueOut: record.blueOut || 0,
          editBlueIn: record.blueIn || 0,
          editRedOut: record.redOut || 0,
          editRedIn: record.redIn || 0,
          editRemark: record.remark || ''
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
      editRouteIndex: -1,
      editPlateIndex: -1,
      newEditRouteName: '',
      newEditPlateNumber: '',
      editSendBlueOut: 0,
      editSendRedOut: 0,
      editBlueOut: 0,
      editBlueIn: 0,
      editRedOut: 0,
      editRedIn: 0,
      editRemark: ''
    })
  },

  onEditRouteChange(e) {
    const index = e.detail.value
    const routeName = this.data.routeList[index]
    this.setData({
      editRouteIndex: index,
      editRouteName: routeName || ''
    })
  },

  onEditPlateChange(e) {
    const index = e.detail.value
    const plateNumber = this.data.plateList[index]
    this.setData({
      editPlateIndex: index,
      editPlateNumber: plateNumber || ''
    })
  },

  onNewEditRouteNameInput(e) {
    this.setData({ newEditRouteName: e.detail.value })
  },

  onNewEditPlateNumberInput(e) {
    this.setData({ newEditPlateNumber: e.detail.value })
  },

  addNewEditRoute() {
    const { newEditRouteName, routeList } = this.data
    if (!newEditRouteName || !newEditRouteName.trim()) return
    const trimmed = newEditRouteName.trim()
    if (!routeList.includes(trimmed)) {
      const updated = db.addRoute(trimmed)
      this.setData({
        routeList: updated,
        editRouteIndex: updated.length - 1,
        editRouteName: trimmed,
        newEditRouteName: ''
      })
    } else {
      this.setData({
        editRouteIndex: routeList.indexOf(trimmed),
        editRouteName: trimmed,
        newEditRouteName: ''
      })
    }
  },

  addNewEditPlate() {
    const { newEditPlateNumber, plateList } = this.data
    if (!newEditPlateNumber || !newEditPlateNumber.trim()) return
    const trimmed = newEditPlateNumber.trim()
    if (!plateList.includes(trimmed)) {
      const updated = db.addPlate(trimmed)
      this.setData({
        plateList: updated,
        editPlateIndex: updated.length - 1,
        editPlateNumber: trimmed,
        newEditPlateNumber: ''
      })
    } else {
      this.setData({
        editPlateIndex: plateList.indexOf(trimmed),
        editPlateNumber: trimmed,
        newEditPlateNumber: ''
      })
    }
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
    const { editRecordId, editRouteName, editPlateNumber, editSendBlueOut, editSendRedOut, editBlueOut, editBlueIn, editRedOut, editRedIn, editRemark } = this.data

    db.updateRecord(editRecordId, {
      routeName: editRouteName.trim(),
      plateNumber: editPlateNumber.trim(),
      sendBlueOut: editSendBlueOut,
      sendRedOut: editSendRedOut,
      blueOut: editBlueOut,
      blueIn: editBlueIn,
      redOut: editRedOut,
      redIn: editRedIn,
      remark: editRemark.trim()
    }).then((result) => {
      if (!result.success) {
        wx.showToast({ title: result.message || '保存失败', icon: 'none' })
        return
      }

      this.hideDataModal()
      this.loadRecords()
      feedback.success()
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      })
    })
  },

  onEditRemarkChange(e) {
    this.setData({ editRemark: e.detail.value })
  },

  showExportModal() {
    let records = []
    
    if (this.data.isSearching) {
      records = this.getFilteredRecords()
    } else {
      records = this.data.records
    }
    
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
      exportSourceRecords: records,
      exportRecords: records,
      exportStats: this.calculateStats(records)
    })
  },

  getFilteredRecords() {
    const { records, searchKeyword, filterStartDate, filterEndDate } = this.data
    
    let filtered = records
    
    if (searchKeyword) {
      const keyword = searchKeyword.toLowerCase()
      filtered = filtered.filter(r => {
        return (r.routeName && r.routeName.toLowerCase().includes(keyword)) ||
               (r.plateNumber && r.plateNumber.toLowerCase().includes(keyword)) ||
               (r.remark && r.remark.toLowerCase().includes(keyword))
      })
    }
    
    if (filterStartDate) {
      filtered = filtered.filter(r => r.date >= filterStartDate)
    }
    
    if (filterEndDate) {
      filtered = filtered.filter(r => r.date <= filterEndDate)
    }
    
    return filtered
  },

  hideExportModal() {
    this.setData({
      showExportModal: false,
      startDate: '',
      endDate: '',
      exportSourceRecords: [],
      exportRecords: [],
      exportStats: { blueOut: 0, blueIn: 0, redOut: 0, redIn: 0 }
    })
  },

  showBackupModal() {
    this.setData({ showBackupModal: true })
  },

  hideBackupModal() {
    this.setData({ showBackupModal: false })
  },

  exportBackup() {
    const jsonStr = db.exportAllData()
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const filename = `backup_${timestamp}.json`
    
    const fs = wx.getFileSystemManager()
    const savedFilePath = `${wx.env.USER_DATA_PATH}/${filename}`
    
    fs.writeFile({
      filePath: savedFilePath,
      data: jsonStr,
      encoding: 'utf8',
      success: () => {
        wx.openDocument({
          filePath: savedFilePath,
          fileType: 'json',
          success: () => {
            feedback.success()
            wx.showToast({ title: '备份已生成', icon: 'success' })
          },
          fail: () => {
            feedback.success()
            wx.showModal({
              title: '已生成文件',
              content: 'JSON 备份文件已生成，但当前设备无法直接打开。可稍后在聊天或文件中转发该文件。',
              showCancel: false
            })
          }
        })
      },
      fail: () => {
        wx.showToast({ title: '创建备份失败', icon: 'none' })
      }
    })
  },

  importBackup() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json'],
      success: (res) => {
        const filePath = res.tempFiles[0].path
        const fs = wx.getFileSystemManager()
        
        fs.readFile({
          filePath: filePath,
          encoding: 'utf8',
          success: (data) => {
            wx.showModal({
              title: '确认恢复',
              content: '恢复数据会覆盖现有数据，确定要继续吗？',
              success: (modalRes) => {
                if (modalRes.confirm) {
                  const result = db.importAllData(data.data)
                  if (result.success) {
                    feedback.success()
                    this.hideBackupModal()
                    this.setData({
                      routeList: db.getRoutes(),
                      plateList: db.getPlates()
                    })
                    if (db.isLoggedIn()) {
                      db.syncRecords().finally(() => {
                        this.loadRecords(true)
                      })
                    } else {
                      this.loadRecords()
                    }
                    wx.showToast({ title: '恢复成功', icon: 'success' })
                  } else {
                    wx.showToast({ title: result.message, icon: 'none' })
                  }
                }
              }
            })
          },
          fail: () => {
            wx.showToast({ title: '读取文件失败', icon: 'none' })
          }
        })
      },
      fail: () => {
      }
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
    const { exportSourceRecords, startDate, endDate } = this.data
    if (!startDate || !endDate) return

    const filtered = exportSourceRecords.filter(r => {
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
    const { exportRecords } = this.data

    if (exportRecords.length === 0) {
      wx.showToast({
        title: '请选择日期范围',
        icon: 'none'
      })
      return
    }

    if (exportRecords.length > 1000) {
      wx.showModal({
        title: '导出记录较多',
        content: `本次将导出 ${exportRecords.length} 条记录，生成 Excel 可能需要一些时间。是否继续？`,
        confirmText: '继续导出',
        success: (res) => {
          if (res.confirm) {
            this.generateExcelFile(exportRecords)
          }
        }
      })
      return
    }

    this.generateExcelFile(exportRecords)
  },

  generateExcelFile(records) {
    wx.showLoading({ title: '生成中...' })
    let excelContent
    try {
      excelContent = db.exportRecordsToExcel(records)
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '生成失败', icon: 'none' })
      return
    }

    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const filename = `records_${timestamp}.xlsx`

    const fs = wx.getFileSystemManager()
    const savedFilePath = `${wx.env.USER_DATA_PATH}/${filename}`

    fs.writeFile({
      filePath: savedFilePath,
      data: excelContent,
      success: () => {
        wx.hideLoading()
        feedback.success()
        wx.openDocument({
          filePath: savedFilePath,
          fileType: 'xlsx',
          success: () => {
            wx.showToast({ title: 'Excel已生成', icon: 'success' })
          },
          fail: () => {
            wx.showModal({
              title: '已生成文件',
              content: 'Excel 文件已生成，但当前设备无法直接打开。可稍后在聊天或文件中转发该文件。',
              showCancel: false
            })
          }
        })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '导出失败', icon: 'none' })
      }
    })
    this.hideExportModal()
  },

  deleteRecord(e) {
    const { id } = e.currentTarget.dataset
    this.setData({
      swipedRecordId: ''
    })
    feedback.heavy()

    wx.showModal({
      title: '确认删除',
      content: '确定要删除这条记录吗？',
      success: (res) => {
        if (res.confirm) {
          db.deleteRecord(id).then((result) => {
            if (!result.success) {
              wx.showToast({ title: result.message || '删除失败', icon: 'none' })
              return
            }

            this.loadRecords()
            feedback.delete()
            wx.showToast({
              title: '已删除',
              icon: 'success'
            })
          })
        }
      }
    })
  },

  onRecordTouchStart(e) {
    const { id } = e.currentTarget.dataset
    const touch = e.touches && e.touches[0]
    if (!touch) return

    this.setData({
      touchStartX: touch.clientX,
      touchStartY: touch.clientY,
      touchRecordId: id
    })
  },

  onRecordTouchMove(e) {
    const touch = e.touches && e.touches[0]
    const { touchStartX, touchStartY, touchRecordId, swipedRecordId } = this.data
    if (!touch || !touchRecordId) return

    const deltaX = touch.clientX - touchStartX
    const deltaY = touch.clientY - touchStartY
    if (Math.abs(deltaX) < 36 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return

    if (deltaX < 0 && swipedRecordId !== touchRecordId) {
      feedback.light()
      this.setData({ swipedRecordId: touchRecordId })
    } else if (deltaX > 0 && swipedRecordId === touchRecordId) {
      this.setData({ swipedRecordId: '' })
    }
  },

  onRecordTouchEnd() {
    this.setData({
      touchStartX: 0,
      touchStartY: 0,
      touchRecordId: ''
    })
  },

  closeSwipedRecord() {
    if (this.data.swipedRecordId) {
      this.setData({ swipedRecordId: '' })
    }
  },

  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value })
  },

  doSearch() {
    this.performSearch()
  },

  clearSearch() {
    this.setData({
      searchKeyword: '',
      isSearching: false
    }, () => {
      this.loadRecords()
    })
  },

  toggleTheme() {
    const isDark = theme.toggle()
    this.setData({ isDarkTheme: isDark })
    feedback.light()
  },

  toggleFilter() {
    this.setData({ showFilter: !this.data.showFilter })
  },

  onFilterStartDateChange(e) {
    this.setData({ filterStartDate: e.detail.value })
  },

  onFilterEndDateChange(e) {
    this.setData({ filterEndDate: e.detail.value })
  },

  resetFilter() {
    this.setData({
      filterStartDate: '',
      filterEndDate: ''
    })
  },

  applyFilter() {
    this.setData({ showFilter: false })
    this.performSearch()
  },

  performSearch() {
    const { records, searchKeyword, filterStartDate, filterEndDate } = this.data
    
    let filtered = records
    
    if (searchKeyword) {
      const keyword = searchKeyword.toLowerCase()
      filtered = filtered.filter(r => {
        return (r.routeName && r.routeName.toLowerCase().includes(keyword)) ||
               (r.plateNumber && r.plateNumber.toLowerCase().includes(keyword)) ||
               (r.remark && r.remark.toLowerCase().includes(keyword))
      })
    }
    
    if (filterStartDate) {
      filtered = filtered.filter(r => r.date >= filterStartDate)
    }
    
    if (filterEndDate) {
      filtered = filtered.filter(r => r.date <= filterEndDate)
    }
    
    const { displayGroupedRecords, hasMore } = this.getPagedGroups(filtered, 1)
    
    this.setData({
      isSearching: !!(searchKeyword || filterStartDate || filterEndDate),
      filteredRecordCount: filtered.length,
      pagingRecords: filtered,
      groupedRecords: displayGroupedRecords,
      displayGroupedRecords: displayGroupedRecords,
      currentPage: 1,
      hasMore: hasMore
    })
  },

  goBack() {
    wx.navigateBack()
  }
})
