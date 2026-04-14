const feedback = {
  enableVibrate: true,
  enableSound: false,

  setVibrate(enable) {
    this.enableVibrate = enable
  },

  setSound(enable) {
    this.enableSound = enable
  },

  light() {
    if (this.enableVibrate) {
      wx.vibrateShort({
        fail: () => {}
      })
    }
  },

  medium() {
    if (this.enableVibrate) {
      wx.vibrateShort({
        type: 'medium',
        fail: () => {}
      })
    }
  },

  heavy() {
    if (this.enableVibrate) {
      wx.vibrateLong({
        fail: () => {}
      })
    }
  },

  success() {
    if (this.enableVibrate) {
      wx.vibrateShort({
        type: 'light',
        fail: () => {}
      })
    }
  },

  error() {
    if (this.enableVibrate) {
      wx.vibrateLong({
        fail: () => {}
      })
    }
  },

  tap() {
    this.light()
  },

  confirm() {
    this.success()
  },

  delete() {
    this.heavy()
  }
}

module.exports = feedback