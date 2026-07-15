const db = require('../../utils/db.js')

Page({
  data: {
    isLoading: false,
    isAuthorized: false,
    isCheckingAuth: false,
    isCloudUnavailable: false,
    userInfo: null
  },

  onLoad(options = {}) {
    this.returnToPrevious = options.from === 'experience'
    this.refreshLoginState()
  },

  onShow() {
    this.refreshLoginState()
  },

  refreshLoginState() {
    const authStatus = db.getAuthStatus()
    this.setData({
      isAuthorized: authStatus !== 'unauthorized',
      isCheckingAuth: authStatus === 'checking',
      isCloudUnavailable: authStatus === 'cloudUnavailable',
      userInfo: db.getUserProfile()
    })
  },

  loginWithWechat() {
    if (this.data.isLoading) return

    const authStatus = db.getAuthStatus()
    if (authStatus === 'authorized') {
      this.goToIndex()
      return
    }
    if (authStatus === 'checking' || authStatus === 'cloudUnavailable') {
      this.doWechatLogin(db.getUserProfile() || {})
      return
    }

    this.doWechatLogin({})
  },

  doWechatLogin(userInfo) {
    const app = getApp()

    this.setData({ isLoading: true })
    wx.showLoading({ title: '登录中...' })

    Promise.resolve()
      .then(() => app && app.syncCloudData ? app.syncCloudData(userInfo) : db.initCloud(userInfo).then(() => db.syncRecords()))
      .then(result => {
        const success = result && (result.success || result.syncResult && result.syncResult.success)
        if (!success && !db.isLoggedIn()) {
          const message = result && result.loginResult && (result.loginResult.message || result.loginResult.error)
          wx.showToast({
            title: message || '登录失败',
            icon: 'none'
          })
          return
        }

        this.refreshLoginState()
        wx.showToast({
          title: '登录成功',
          icon: 'success'
        })
        setTimeout(() => {
          this.goToIndex()
        }, 300)
      })
      .catch(err => {
        wx.showToast({
          title: err.message || '登录失败',
          icon: 'none'
        })
      })
      .finally(() => {
        wx.hideLoading()
        this.setData({ isLoading: false })
      })
  },

  showPrivacyInfo() {
    wx.showModal({
      title: '登录与数据说明',
      content: '无需登录即可浏览和使用本地功能。只有您主动点击“登录并开启云同步”后，小程序才会使用微信账号标识区分个人数据。登录同步不获取手机号、头像或昵称。',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  goToIndex() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    if (this.returnToPrevious && pages.length > 1) {
      wx.navigateBack()
      return
    }
    wx.redirectTo({ url: '/pages/index/index' })
  }
})
