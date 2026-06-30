const db = require('../../utils/db.js')
const theme = require('../../utils/theme.js')
const feedback = require('../../utils/feedback.js')

Page({
  data: {
    isDarkTheme: false,
    details: null,
    isSyncing: false
  },

  onLoad() {
    this.refreshDetails()
  },

  onShow() {
    this.refreshDetails()
  },

  refreshDetails() {
    this.setData({
      isDarkTheme: theme.isDark,
      details: db.getSyncDetails()
    })
  },

  retrySync() {
    if (this.data.isSyncing) return

    if (!db.hasAuthorizedLogin()) {
      wx.showToast({ title: '请先微信授权', icon: 'none' })
      wx.redirectTo({ url: '/pages/welcome/welcome' })
      return
    }

    this.setData({ isSyncing: true })
    wx.showLoading({ title: '同步中...' })

    Promise.resolve()
      .then(() => db.isLoggedIn() ? { success: true } : db.initCloud())
      .then(loginResult => {
        if (!db.isLoggedIn()) {
          return {
            success: false,
            message: loginResult.message || loginResult.error || '云同步暂不可用'
          }
        }
        return db.syncRecords()
      })
      .then(result => {
        this.refreshDetails()
        if (result.success) {
          feedback.success()
          wx.showToast({ title: '同步完成', icon: 'success' })
        } else {
          wx.showToast({ title: result.message || '同步失败', icon: 'none' })
        }
      })
      .catch(err => {
        this.refreshDetails()
        wx.showToast({ title: err.message || '同步失败', icon: 'none' })
      })
      .finally(() => {
        wx.hideLoading()
        this.setData({ isSyncing: false })
      })
  },

  goLogin() {
    wx.redirectTo({ url: '/pages/welcome/welcome' })
  }
})
