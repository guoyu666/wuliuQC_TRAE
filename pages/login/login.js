const app = getApp()

Page({
  async loginWithWechat() {
    wx.showLoading({ title: '登录中...' })

    try {
      const openid = await this.getOpenid()
      
      const profileRes = await new Promise((resolve, reject) => {
        wx.getUserProfile({
          desc: '用于完善用户资料',
          success: resolve,
          fail: reject
        })
      })

      const userInfo = {
        nickName: profileRes.userInfo.nickName,
        avatarUrl: profileRes.userInfo.avatarUrl,
        loginType: 'wechat',
        loginTime: new Date().toISOString()
      }

      await this.saveUserInfo(userInfo, openid)

      wx.setStorageSync('userInfo', userInfo)
      wx.setStorageSync('openid', openid)
      wx.setStorageSync('guestMode', false)
      app.globalData.userInfo = userInfo
      app.globalData.openid = openid

      wx.hideLoading()
      
      this.syncLocalData()
      
      wx.showToast({
        title: '登录成功',
        icon: 'success'
      })
      
      setTimeout(() => {
        this.navigateToIndex()
      }, 1500)
    } catch (err) {
      wx.hideLoading()
      if (err.errMsg && err.errMsg.includes('getUserProfile:fail')) {
        wx.showToast({
          title: '需要授权才能登录',
          icon: 'none'
        })
      } else {
        wx.showToast({
          title: '登录失败',
          icon: 'none'
        })
      }
      console.error(err)
    }
  },

  async getOpenid() {
    try {
      const result = await wx.cloud.callFunction({
        name: 'login'
      })
      return result.openid
    } catch (err) {
      console.error('获取openid失败', err)
      return null
    }
  },

  async saveUserInfo(userInfo, openid) {
    try {
      const db = wx.cloud.database()
      const users = db.collection('users')
      
      const checkRes = await users.where({
        _openid: openid
      }).get()

      if (checkRes.data && checkRes.data.length > 0) {
        await users.doc(checkRes.data[0]._id).update({
          data: {
            ...userInfo,
            updateTime: new Date().toISOString()
          }
        })
      } else {
        await users.add({
          data: {
            ...userInfo,
            _openid: openid,
            createTime: new Date().toISOString(),
            updateTime: new Date().toISOString()
          }
        })
      }
    } catch (err) {
      console.log('云数据库操作失败', err)
    }
  },

  async syncLocalData() {
    try {
      const db = require('../../utils/db.js')
      await db.syncLocalToCloud()
    } catch (err) {
      console.log('同步数据失败', err)
    }
  },

  navigateToIndex() {
    wx.reLaunch({
      url: '/pages/index/index'
    })
  }
})
