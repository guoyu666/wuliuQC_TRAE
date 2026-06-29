function showStorageError(err) {
  console.error('本地存储写入失败', err)
  if (typeof wx !== 'undefined' && wx.showToast) {
    wx.showToast({
      title: '本地存储空间不足或写入失败',
      icon: 'none'
    })
  }
}

function get(key, fallback) {
  try {
    const value = wx.getStorageSync(key)
    return value === '' || value === undefined ? fallback : value
  } catch (err) {
    console.error(`读取本地存储失败: ${key}`, err)
    return fallback
  }
}

function set(key, value) {
  try {
    wx.setStorageSync(key, value)
    return true
  } catch (err) {
    showStorageError(err)
    return false
  }
}

module.exports = {
  get,
  set
}
