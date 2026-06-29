const db = require('./utils/db.js')
const theme = require('./utils/theme.js')
const config = require('./utils/config.js')

App({
  onLaunch: async function () {
    theme.init()
    db.migrateStorageIfNeeded()

    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      this.notifySyncReady({ success: false, message: '当前基础库不支持云能力' })
      return
    }

    wx.cloud.init({
      env: config.cloud.env,
      traceUser: true
    })

    const loginResult = await db.initCloud()

    if (loginResult.success) {
      console.log('云开发登录成功')

      if (loginResult.isNewUser) {
        console.log('欢迎新用户')
      }

      const syncResult = await db.syncRecords()
      if (syncResult.success) {
        console.log('数据同步完成', syncResult)
      } else {
        console.log('同步失败或无需同步', syncResult.message)
      }
      this.notifySyncReady(syncResult)
    } else {
      console.log('云开发登录失败，将使用本地存储模式')
      this.notifySyncReady(loginResult)
    }
  },

  onSyncReady(callback) {
    if (typeof callback !== 'function') {
      return function noop() {}
    }

    if (this.globalData.syncReady) {
      callback(this.globalData.syncResult)
      return function noop() {}
    }

    this.globalData.syncListeners.push(callback)
    return () => {
      this.globalData.syncListeners = this.globalData.syncListeners.filter(listener => listener !== callback)
    }
  },

  notifySyncReady(result) {
    this.globalData.syncReady = true
    this.globalData.syncResult = result
    const listeners = this.globalData.syncListeners.slice()
    this.globalData.syncListeners = []
    listeners.forEach(listener => {
      listener(result)
    })
  },

  globalData: {
    userInfo: null,
    openid: null,
    isLoggedIn: false,
    syncReady: false,
    syncResult: null,
    syncListeners: []
  }
})
