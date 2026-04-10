const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const db = cloud.database()
  const users = db.collection('users')

  try {
    const { data } = await users.where({
      _openid: wxContext.OPENID
    }).get()

    if (data.length === 0) {
      await users.add({
        data: {
          _openid: wxContext.OPENID,
          nickname: event.nickname || '用户',
          createTime: new Date(),
          lastLoginTime: new Date()
        }
      })
      return {
        success: true,
        isNewUser: true,
        openid: wxContext.OPENID
      }
    } else {
      await users.doc(data[0]._id).update({
        data: {
          lastLoginTime: new Date()
        }
      })
      return {
        success: true,
        isNewUser: false,
        openid: wxContext.OPENID,
        userInfo: data[0]
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