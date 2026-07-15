const util = require('../../utils/util.js')
const db = require('../../utils/db.js')
const theme = require('../../utils/theme.js')
const feedback = require('../../utils/feedback.js')
const recordUtils = require('../../utils/records.js')
const requestGate = require('../../utils/requestGate.js')
const config = require('../../utils/config.js')
const fileExport = require('../../utils/fileExport.js')

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
    exportFileName: '',
    exportRecords: [],
    exportSourceRecords: [],
    exportStats: {
      blueOut: 0,
      blueIn: 0,
      redOut: 0,
      redIn: 0
    },
    currentPage: 1,
    pageSize: config.history.pageSize,
    hasMore: true,
    historyCursor: '',
    isLoadingMore: false,
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
    this.skipNextShowReload = true
    this.setData({
      routeList: db.getRoutes(),
      plateList: db.getPlates(),
      isDarkTheme: theme.isDark,
      syncStatus: db.getSyncStatus()
    })
    this.setupSyncRefresh()
    this.loadRecords()
  },

  onShow() {
    this.setData({
      isDarkTheme: theme.isDark,
      syncStatus: db.getSyncStatus()
    })
    if (this.skipNextShowReload) {
      this.skipNextShowReload = false
      return
    }
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

  onUnload() {
    this.clearSearchTimer()
    if (this.unsubscribeSyncReady) {
      this.unsubscribeSyncReady()
      this.unsubscribeSyncReady = null
    }
  },

  setupSyncRefresh() {
    const app = getApp()
    if (!app || !app.onSyncReady || this.unsubscribeSyncReady) return

    this.unsubscribeSyncReady = app.onSyncReady(() => {
      this.setData({
        routeList: db.getRoutes(),
        plateList: db.getPlates(),
        syncStatus: db.getSyncStatus()
      })
      this.loadRecords(true)
    })
  },

  loadRecords(forceRefresh = false) {
    const requestId = requestGate.next(this, 'loadRecords')
    return db.getHistoryRecordsPage({
      pageSize: this.data.pageSize,
      forceRefresh
    }).then(page => {
      if (!requestGate.isCurrent(this, 'loadRecords', requestId)) return

      const sortedRecords = page.records || []
      const displayGroupedRecords = recordUtils.groupByDate(sortedRecords)

      this.setData({
        records: sortedRecords,
        pagingRecords: sortedRecords,
        groupedRecords: displayGroupedRecords,
        currentPage: 1,
        hasMore: page.hasMore,
        historyCursor: page.nextCursor || '',
        isLoadingMore: false,
        displayGroupedRecords: displayGroupedRecords,
        totalCount: sortedRecords.length,
        syncStatus: db.getSyncStatus()
      })
    })
  },

  refreshSyncStatus() {
    this.setData({ syncStatus: db.getSyncStatus() })
  },

  goToSyncDetail() {
    wx.navigateTo({ url: '/pages/sync-detail/sync-detail' })
  },

  goToLogin() {
    wx.navigateTo({ url: '/pages/welcome/welcome?from=experience' })
  },

  retrySync() {
    if (!db.hasAuthorizedLogin()) {
      wx.showToast({ title: '请先微信登录', icon: 'none' })
      setTimeout(() => {
        wx.redirectTo({ url: '/pages/welcome/welcome' })
      }, 500)
      return
    }

    wx.showLoading({ title: '同步中...' })
    Promise.resolve()
      .then(() => db.isLoggedIn() ? { success: true } : db.initCloud())
      .then(loginResult => {
        if (!db.isLoggedIn()) {
          return {
            success: false,
            message: loginResult.message || loginResult.error || '云端未登录，稍后再试'
          }
        }
        return db.syncRecords()
      })
      .then(result => {
        if (result.success) {
          feedback.success()
          wx.showToast({ title: '同步完成', icon: 'success' })
        } else {
          wx.showToast({ title: result.message || '同步失败', icon: 'none' })
        }
      })
      .catch(err => {
        wx.showToast({ title: err.message || '同步失败', icon: 'none' })
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
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '取消中...' })
          const result = await db.cancelPendingCloudReplace()
          wx.hideLoading()
          if (!result.success) {
            wx.showToast({ title: result.message || '取消失败', icon: 'none' })
            this.refreshSyncStatus()
            return
          }
          wx.showToast({ title: result.committed ? '恢复已生效' : '已取消恢复', icon: 'success' })
          this.loadRecords(true).finally(() => this.refreshSyncStatus())
        }
      }
    })
  },

  loadMore() {
    const { pagingRecords, currentPage, hasMore, isSearching, isLoadingMore } = this.data

    if (!hasMore || isLoadingMore) return

    if (!isSearching) {
      this.setData({ isLoadingMore: true })
      db.getHistoryRecordsPage({
        cursor: this.data.historyCursor,
        pageSize: this.data.pageSize
      }).then(page => {
        const recordMap = new Map()
        ;[...this.data.records, ...(page.records || [])].forEach(record => {
          recordMap.set(record.id || record._id, record)
        })
        const records = Array.from(recordMap.values())
        const displayGroupedRecords = recordUtils.groupByDate(records)
        this.setData({
          records,
          pagingRecords: records,
          groupedRecords: displayGroupedRecords,
          displayGroupedRecords,
          currentPage: currentPage + 1,
          hasMore: page.hasMore,
          historyCursor: page.nextCursor || '',
          isLoadingMore: false,
          totalCount: records.length
        })
      }).catch(() => {
        this.setData({ isLoadingMore: false })
        wx.showToast({ title: '加载更多失败', icon: 'none' })
      })
      return
    }

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
      displayGroupedRecords: recordUtils.groupByDate(loadedRecords, records),
      hasMore: records.length > loadedRecords.length,
      loadedCount: loadedRecords.length
    }
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
    this.setData({ editSendBlueOut: util.normalizeCountInput(e.detail.value) })
  },

  onEditSendRedOutChange(e) {
    this.setData({ editSendRedOut: util.normalizeCountInput(e.detail.value) })
  },

  onEditBlueOutChange(e) {
    this.setData({ editBlueOut: util.normalizeCountInput(e.detail.value) })
  },

  onEditBlueInChange(e) {
    this.setData({ editBlueIn: util.normalizeCountInput(e.detail.value) })
  },

  onEditRedOutChange(e) {
    this.setData({ editRedOut: util.normalizeCountInput(e.detail.value) })
  },

  onEditRedInChange(e) {
    this.setData({ editRedIn: util.normalizeCountInput(e.detail.value) })
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
    wx.showLoading({ title: '准备导出...' })
    const recordsPromise = this.data.isSearching
      ? Promise.resolve(this.getFilteredRecords())
      : db.getAllRecords({ forceRefresh: true })

    recordsPromise.then(records => {
      if (records.length === 0) {
        wx.showToast({ title: '暂无记录可导出', icon: 'none' })
        return
      }

      const dates = records.map(r => r.date).filter(Boolean).sort()
      const defaultFileName = `records_${util.formatDate(new Date()).replace(/-/g, '')}`
      this.setData({
        showExportModal: true,
        startDate: dates[0] || '',
        endDate: dates[dates.length - 1] || '',
        exportFileName: defaultFileName,
        exportSourceRecords: records,
        exportRecords: records,
        exportStats: recordUtils.calculateStats(records)
      })
    }).catch(err => {
      wx.showToast({ title: err.message || '准备导出失败', icon: 'none' })
    }).finally(() => {
      wx.hideLoading()
    })
  },

  getFilteredRecords() {
    const { records, searchKeyword, filterStartDate, filterEndDate } = this.data
    return recordUtils.filterRecords(records, {
      keyword: searchKeyword,
      startDate: filterStartDate,
      endDate: filterEndDate
    })
  },

  hideExportModal() {
    this.setData({
      showExportModal: false,
      startDate: '',
      endDate: '',
      exportFileName: '',
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

    fileExport.writeAndOpen({
      filename,
      data: jsonStr,
      encoding: 'utf8',
      fileType: 'json',
      successTitle: '备份已生成',
      openFailContent: 'JSON 备份文件已生成，但当前设备无法直接打开。可稍后在聊天或文件中转发该文件。',
      writeFailTitle: '创建备份失败'
    }).then(result => {
      if (result.success) {
        feedback.success()
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
            const jsonStr = data.data
            const preview = db.inspectBackupData(jsonStr)
            if (!preview.success) {
              wx.showToast({ title: preview.message, icon: 'none' })
              return
            }

            const backupTime = preview.timestamp ? preview.timestamp.replace('T', ' ').slice(0, 19) : '未知'
            const legacyText = preview.isLegacy ? '\n检测到旧版备份，将按当前格式迁移。' : ''
            wx.showModal({
              title: '确认恢复',
              content: `备份版本：${preview.version}\n备份时间：${backupTime}\n记录：${preview.recordCount} 条\n线路：${preview.routeCount} 个\n车牌：${preview.plateCount} 个${legacyText}\n\n恢复数据会覆盖现有数据，确定要继续吗？`,
              success: (modalRes) => {
                if (modalRes.confirm) {
                  this.restoreBackupData(jsonStr)
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

  restoreBackupData(jsonStr) {
    wx.showLoading({ title: '恢复中...' })
    db.importAllData(jsonStr).then(result => {
      if (!result.success) {
        wx.showToast({ title: result.message, icon: 'none' })
        return null
      }

      feedback.success()
      this.hideBackupModal()
      this.setData({
        routeList: db.getRoutes(),
        plateList: db.getPlates()
      })

      if (!db.isLoggedIn()) {
        return this.loadRecords().then(() => ({ localOnly: true }))
      }

      return db.syncRecords()
        .then(syncResult => {
          return this.loadRecords(true).then(() => syncResult)
        })
    }).then(syncResult => {
      if (!syncResult) return
      this.refreshSyncStatus()
      if (syncResult.localOnly) {
        wx.showToast({ title: '本地恢复成功', icon: 'success' })
      } else if (syncResult.success) {
        wx.showToast({ title: '恢复并同步成功', icon: 'success' })
      } else {
        wx.showToast({ title: syncResult.message || '本地已恢复，云端待重试', icon: 'none' })
      }
    }).catch(err => {
      wx.showToast({ title: err.message || '恢复失败', icon: 'none' })
    }).finally(() => {
      wx.hideLoading()
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

  onExportFileNameInput(e) {
    this.setData({ exportFileName: e.detail.value })
  },

  normalizeExportFileName() {
    const defaultFileName = `records_${util.formatDate(new Date()).replace(/-/g, '')}`
    const normalized = fileExport.normalizeFilename(this.data.exportFileName, {
      extension: 'xlsx',
      fallback: defaultFileName
    })
    this.setData({ exportFileName: normalized.slice(0, -5) })
  },

  getExportFileName(inputValue = this.data.exportFileName) {
    const defaultFileName = `records_${util.formatDate(new Date()).replace(/-/g, '')}`
    return fileExport.normalizeFilename(inputValue, {
      extension: 'xlsx',
      fallback: defaultFileName
    })
  },

  filterExportRecords() {
    const { exportSourceRecords, startDate, endDate } = this.data
    if (!startDate || !endDate) return

    const filtered = recordUtils.filterRecords(exportSourceRecords, {
      startDate,
      endDate
    })

    this.setData({
      exportRecords: filtered,
      exportStats: recordUtils.calculateStats(filtered)
    })
  },

  exportRecords(e) {
    const { exportRecords } = this.data
    const formValue = e && e.detail && e.detail.value
    const submittedFileName = formValue && Object.prototype.hasOwnProperty.call(formValue, 'exportFileName')
      ? formValue.exportFileName
      : this.data.exportFileName
    const filename = this.getExportFileName(submittedFileName)
    this.setData({ exportFileName: filename.slice(0, -5) })

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
            this.generateExcelFile(exportRecords, filename)
          }
        }
      })
      return
    }

    this.generateExcelFile(exportRecords, filename)
  },

  generateExcelFile(records, filename) {
    wx.showLoading({ title: '生成中...' })
    let excelContent
    try {
      excelContent = db.exportRecordsToExcel(records)
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '生成失败', icon: 'none' })
      return
    }

    fileExport.writeAndOpen({
      filename,
      data: excelContent,
      fileType: 'xlsx',
      successTitle: '自定义Excel已生成',
      openFailContent: `${filename} 已生成，但当前设备无法直接打开。可稍后在聊天或文件中转发该文件。`,
      writeFailTitle: '导出失败'
    }).then(result => {
      wx.hideLoading()
      if (result.success) {
        feedback.success()
      }
    }).catch(() => {
        wx.hideLoading()
        wx.showToast({ title: '导出失败', icon: 'none' })
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
    this.clearSearchTimer()
    this.searchTimer = setTimeout(() => {
      this.performSearch()
      this.searchTimer = null
    }, 300)
  },

  doSearch() {
    this.clearSearchTimer()
    this.performSearch()
  },

  clearSearch() {
    this.clearSearchTimer()
    this.setData({
      searchKeyword: '',
      isSearching: false,
      filteredRecordCount: 0,
      filterStartDate: '',
      filterEndDate: ''
    }, () => {
      this.loadRecords()
    })
  },

  clearSearchTimer() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer)
      this.searchTimer = null
    }
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
    const { searchKeyword, filterStartDate, filterEndDate } = this.data
    const requestId = requestGate.next(this, 'search')
    return db.getAllRecords().then(records => {
      if (!requestGate.isCurrent(this, 'search', requestId)) return
      const filtered = recordUtils.filterRecords(records, {
        keyword: searchKeyword,
        startDate: filterStartDate,
        endDate: filterEndDate
      })
      const { displayGroupedRecords, hasMore } = this.getPagedGroups(filtered, 1)

      this.setData({
        records,
        isSearching: !!(searchKeyword || filterStartDate || filterEndDate),
        filteredRecordCount: filtered.length,
        pagingRecords: filtered,
        groupedRecords: displayGroupedRecords,
        displayGroupedRecords,
        currentPage: 1,
        hasMore
      })
    })
  },

  goBack() {
    wx.navigateBack()
  }
})
