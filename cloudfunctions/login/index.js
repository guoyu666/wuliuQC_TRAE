exports.main = async (event, context) => {
  const wxContext = wx.getWXContext()
  
  return {
    event,
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID
  }
}
