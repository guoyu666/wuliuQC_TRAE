const theme = {
  isDark: false,

  init() {
    const saved = wx.getStorageSync('theme')
    if (saved === 'dark') {
      this.isDark = true
      this.apply()
    }
  },

  toggle() {
    this.isDark = !this.isDark
    wx.setStorageSync('theme', this.isDark ? 'dark' : 'light')
    this.apply()
    return this.isDark
  },

  apply() {
    if (this.isDark) {
      wx.setBackgroundColor({
        backgroundColor: '#1a1a2e',
        backgroundColorTop: '#1a1a2e',
        backgroundColorBottom: '#16213e'
      })
    } else {
      wx.setBackgroundColor({
        backgroundColor: '#F5F5F5',
        backgroundColorTop: '#F5F5F5',
        backgroundColorBottom: '#F5F5F5'
      })
    }
  },

  getTheme() {
    return this.isDark ? 'dark' : 'light'
  }
}

module.exports = theme