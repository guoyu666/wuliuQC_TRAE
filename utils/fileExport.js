function normalizeFilename(filename, options = {}) {
  const extensionValue = String(options.extension || '').replace(/^\.+/, '')
  const extension = extensionValue ? `.${extensionValue}` : ''
  let fallback = String(options.fallback || 'export').trim() || 'export'
  const maxBaseLength = Math.max(1, Number(options.maxBaseLength || 80))
  let baseName = String(filename || '').trim()

  if (extension && baseName.toLowerCase().endsWith(extension.toLowerCase())) {
    baseName = baseName.slice(0, -extension.length)
  }
  if (extension && fallback.toLowerCase().endsWith(extension.toLowerCase())) {
    fallback = fallback.slice(0, -extension.length)
  }

  baseName = baseName
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/[.\s]+$/g, '')
    .trim()

  if (!baseName || baseName === '.' || baseName === '..') {
    baseName = fallback
      .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
      .replace(/[.\s]+$/g, '')
      .trim() || 'export'
  }

  baseName = Array.from(baseName).slice(0, maxBaseLength).join('')
  return `${baseName}${extension}`
}

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
    const safeFilename = normalizeFilename(filename, {
      extension: fileType,
      fallback: 'export'
    })
    const savedFilePath = `${wx.env.USER_DATA_PATH}/${safeFilename}`

    fs.writeFile({
      filePath: savedFilePath,
      data,
      encoding,
      success: () => {
        wx.openDocument({
          filePath: savedFilePath,
          fileType,
          showMenu: true,
          success: () => {
            wx.showToast({ title: successTitle, icon: 'success' })
            resolve({ success: true, filePath: savedFilePath, filename: safeFilename, opened: true })
          },
          fail: () => {
            wx.showModal({
              title: '已生成文件',
              content: openFailContent,
              showCancel: false
            })
            resolve({ success: true, filePath: savedFilePath, filename: safeFilename, opened: false })
          }
        })
      },
      fail: () => {
        wx.showToast({ title: writeFailTitle, icon: 'none' })
        resolve({ success: false, filePath: savedFilePath, filename: safeFilename })
      }
    })
  })
}

module.exports = {
  normalizeFilename,
  writeAndOpen
}
