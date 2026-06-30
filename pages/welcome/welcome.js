const db = require('../../utils/db.js')

Page({
  data: {
    isLoading: false,
    isAuthorized: false,
    isCloudUnavailable: false,
    userInfo: null
  },

  onLoad() {
    this.refreshLoginState()
  },

  onShow() {
    this.refreshLoginState()
  },

  refreshLoginState() {
    const authStatus = db.getAuthStatus()
    this.setData({
      isAuthorized: authStatus !== 'unauthorized',
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
    if (authStatus === 'cloudUnavailable') {
      this.doWechatLogin(db.getUserProfile() || {})
      return
    }

    if (!wx.getUserProfile) {
      this.doWechatLogin({})
      return
    }

    wx.getUserProfile({
      desc: '用于展示账号信息并同步您的收发记录',
      success: (res) => {
        this.doWechatLogin(res.userInfo || {})
      },
      fail: () => {
        wx.showToast({
          title: '需要授权后同步数据',
          icon: 'none'
        })
      }
    })
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
      title: '授权与数据说明',
      content: '小程序会使用微信账号标识区分您的个人数据；头像和昵称仅用于展示当前账号。您的收发记录会按微信账号同步到云端，不会与其他微信账号混用。',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  goToIndex() {
    wx.redirectTo({
      url: '/pages/index/index'
    })
  }
})
