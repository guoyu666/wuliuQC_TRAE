const db = require('./utils/db.js')

App({
  onLaunch: async function () {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }

    wx.cloud.init({
      env: 'cloud1-9gvo70lwa48bb03a',
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
    } else {
      console.log('云开发登录失败，将使用本地存储模式')
    }
  },

  globalData: {
    userInfo: null,
    openid: null,
    isLoggedIn: false
  }
})