const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const db = cloud.database()
  const users = db.collection('users')
  const userInfo = event.userInfo || {}
  const profile = {
    nickName: userInfo.nickName || userInfo.nickname || event.nickname || '微信用户',
    avatarUrl: userInfo.avatarUrl || '',
    updateTime: new Date()
  }

  try {
    const { data } = await users.where({
      _openid: wxContext.OPENID
    }).get()

    if (data.length === 0) {
      await users.add({
        data: {
          _openid: wxContext.OPENID,
          nickname: profile.nickName,
          nickName: profile.nickName,
          avatarUrl: profile.avatarUrl,
          createTime: new Date(),
          lastLoginTime: new Date()
        }
      })
      return {
        success: true,
        isNewUser: true,
        openid: wxContext.OPENID,
        userInfo: profile
      }
    } else {
      await users.doc(data[0]._id).update({
        data: {
          nickname: profile.nickName,
          nickName: profile.nickName,
          avatarUrl: profile.avatarUrl,
          lastLoginTime: new Date(),
          updateTime: profile.updateTime
        }
      })
      return {
        success: true,
        isNewUser: false,
        openid: wxContext.OPENID,
        userInfo: {
          ...data[0],
          nickName: profile.nickName,
          avatarUrl: profile.avatarUrl
        }
      }
    }
  } catch (err) {
    return {
      success: false,
      error: err.message,
      openid: wxContext.OPENID
    }
  }
}
