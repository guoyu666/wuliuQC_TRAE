function writeAndOpen(options) {
  const {
    filename,
    data,
    encoding,
    fileType,
    successTitle = '文件已生成',
    openFailContent = '文件已生成，但当前设备无法直接打开。可稍后在聊天或文件中转发该文件。',
    writeFailTitle = '生成失败'
  } = options

  return new Promise((resolve) => {
    const fs = wx.getFileSystemManager()
    const savedFilePath = `${wx.env.USER_DATA_PATH}/${filename}`

    fs.writeFile({
      filePath: savedFilePath,
      data,
      encoding,
      success: () => {
        wx.openDocument({
          filePath: savedFilePath,
          fileType,
          success: () => {
            wx.showToast({ title: successTitle, icon: 'success' })
            resolve({ success: true, filePath: savedFilePath, opened: true })
          },
          fail: () => {
            wx.showModal({
              title: '已生成文件',
              content: openFailContent,
              showCancel: false
            })
            resolve({ success: true, filePath: savedFilePath, opened: false })
          }
        })
      },
      fail: () => {
        wx.showToast({ title: writeFailTitle, icon: 'none' })
        resolve({ success: false, filePath: savedFilePath })
      }
    })
  })
}

module.exports = {
  writeAndOpen
}
