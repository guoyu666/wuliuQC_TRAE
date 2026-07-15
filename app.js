const db = require('./utils/db.js')
const theme = require('./utils/theme.js')
const config = require('./utils/config.js')

App({
  onLaunch: async function () {
    theme.init()

    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      this.notifySyncReady({ success: false, message: '当前基础库不支持云能力' })
      return
    }

    wx.cloud.init({
      env: config.cloud.env,
      traceUser: true
    })

    db.restoreLoginState()
    db.migrateStorageIfNeeded()
    this.globalData.openid = null
    this.globalData.userInfo = null
    this.globalData.isLoggedIn = false
    this.notifySyncReady({ success: true, message: '已进入本地体验模式', guestMode: true })
  },

  onShow() {
    this.startPresenceHeartbeat()
  },

  onHide() {
    this.stopPresenceHeartbeat()
  },

  async syncCloudData(userInfo = {}) {
    const loginResult = await db.initCloud(userInfo)

    if (loginResult.success) {
      const syncResult = await db.syncRecords()
      this.globalData.openid = loginResult.openid
      this.globalData.userInfo = loginResult.userInfo || null
      this.globalData.isLoggedIn = true
      this.startPresenceHeartbeat()
      this.notifySyncReady(syncResult)
      return {
        success: true,
        loginResult,
        syncResult
      }
    } else {
      this.globalData.isLoggedIn = false
      this.stopPresenceHeartbeat()
      this.notifySyncReady(loginResult)
      return {
        success: false,
        loginResult
      }
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

  startPresenceHeartbeat() {
    if (!db.isLoggedIn()) {
      this.stopPresenceHeartbeat()
      return
    }
    this.refreshPresence()
    if (this.presenceTimer) return
    this.presenceTimer = setInterval(() => {
      this.refreshPresence()
    }, config.cloud.presenceRefreshInterval || 30 * 1000)
  },

  stopPresenceHeartbeat() {
    if (!this.presenceTimer) return
    clearInterval(this.presenceTimer)
    this.presenceTimer = null
  },

  refreshPresence() {
    if (this.presencePromise) return this.presencePromise
    this.presencePromise = db.refreshOnlinePresence().then(result => {
      if (!result.success) return result
      this.globalData.onlinePresence = result
      const listeners = this.globalData.presenceListeners.slice()
      listeners.forEach(listener => listener(result))
      return result
    }).finally(() => {
      this.presencePromise = null
    })
    return this.presencePromise
  },

  onPresenceUpdate(callback) {
    if (typeof callback !== 'function') return function noop() {}
    this.globalData.presenceListeners.push(callback)
    if (this.globalData.onlinePresence) {
      callback(this.globalData.onlinePresence)
    }
    return () => {
      this.globalData.presenceListeners = this.globalData.presenceListeners.filter(listener => listener !== callback)
    }
  },

  globalData: {
    userInfo: null,
    openid: null,
    isLoggedIn: false,
    syncReady: false,
    syncResult: null,
    syncListeners: [],
    onlinePresence: null,
    presenceListeners: []
  }
})
