const util = require('./util.js')

let openid = null
let isCloudEnabled = false

function setOpenid(id) {
  openid = id
  wx.setStorageSync('openid', id)
}

function getOpenid() {
  if (!openid) {
    openid = wx.getStorageSync('openid')
  }
  return openid
}

function isLoggedIn() {
  return !!openid && isCloudEnabled
}

function setCloudEnabled(enabled) {
  isCloudEnabled = enabled
  wx.setStorageSync('cloudEnabled', enabled)
}

function getCloudEnabled() {
  if (!wx.getStorageSync('cloudEnabled')) {
    return false
  }
  return isCloudEnabled
}

async function initCloud() {
  try {
    const result = await wx.cloud.callFunction({
      name: 'login'
    })

    if (result.result && result.result.success) {
      openid = result.result.openid
      isCloudEnabled = true
      wx.setStorageSync('openid', openid)
      wx.setStorageSync('cloudEnabled', true)
      console.log('云登录成功', openid)
      return {
        success: true,
        openid: openid,
        isNewUser: result.result.isNewUser
      }
    }

    return {
      success: false,
      message: '登录失败'
    }
  } catch (err) {
    console.error('云登录失败', err)
    isCloudEnabled = false
    return {
      success: false,
      error: err.message
    }
  }
}

async function _addToCloud(collectionName, data) {
  if (!isCloudEnabled || !openid) return null
  try {
    const db = wx.cloud.database()
    return await db.collection(collectionName).add({ data: { _openid: openid, ...data, syncTime: new Date() } })
  } catch (err) {
    console.error('云端添加失败', err)
    return null
  }
}

async function _updateInCloud(collectionName, id, data) {
  if (!isCloudEnabled || !openid) return null
  try {
    const db = wx.cloud.database()
    const res = await db.collection(collectionName).where({ _openid: openid, id }).get()
    if (res.data && res.data.length > 0) {
      return await db.collection(collectionName).doc(res.data[0]._id).update({ data })
    }
    return null
  } catch (err) {
    console.error('云端更新失败', err)
    return null
  }
}

async function _deleteFromCloud(collectionName, id) {
  if (!isCloudEnabled || !openid) return null
  try {
    const db = wx.cloud.database()
    const res = await db.collection(collectionName).where({ _openid: openid, id }).get()
    if (res.data && res.data.length > 0) {
      return await db.collection(collectionName).doc(res.data[0]._id).remove()
    }
    return null
  } catch (err) {
    console.error('云端删除失败', err)
    return null
  }
}

async function addRecord(record) {
  const localRecords = wx.getStorageSync('records') || []
  const newRecord = {
    ...record,
    id: Date.now().toString(),
    createTime: util.formatTime(new Date()),
    synced: false
  }

  localRecords.push(newRecord)
  wx.setStorageSync('records', localRecords)

  const cloudResult = await _addToCloud('records', {
    id: newRecord.id,
    date: newRecord.date,
    routeName: newRecord.routeName,
    plateNumber: newRecord.plateNumber,
    sendBlueOut: newRecord.sendBlueOut || 0,
    sendRedOut: newRecord.sendRedOut || 0,
    blueOut: newRecord.blueOut,
    blueIn: newRecord.blueIn,
    redOut: newRecord.redOut,
    redIn: newRecord.redIn,
    remark: newRecord.remark,
    createTime: new Date(newRecord.createTime)
  })

  if (cloudResult) {
    newRecord.synced = true
    const index = localRecords.findIndex(r => r.id === newRecord.id)
    if (index !== -1) {
      localRecords[index] = newRecord
      wx.setStorageSync('records', localRecords)
    }
    return { success: true, id: newRecord.id, synced: true }
  }

  return { success: true, id: newRecord.id, synced: false }
}

async function getTodayRecords() {
  const today = util.formatDate(new Date())
  const records = wx.getStorageSync('records') || []
  const todayRecords = records.filter(r => r.date === today)
  return todayRecords
}

async function getAllRecords() {
  if (isCloudEnabled && openid) {
    try {
      const db = wx.cloud.database()
      const res = await db.collection('records')
        .where({ _openid: openid })
        .orderBy('createTime', 'desc')
        .get()

      if (res.data && res.data.length > 0) {
        const cloudRecords = res.data.map(r => ({
          id: r.id || r._id,
          date: r.date,
          routeName: r.routeName,
          plateNumber: r.plateNumber,
          sendBlueOut: r.sendBlueOut || 0,
          sendRedOut: r.sendRedOut || 0,
          blueOut: r.blueOut,
          blueIn: r.blueIn,
          redOut: r.redOut,
          redIn: r.redIn,
          remark: r.remark,
          createTime: r.createTime,
          synced: true,
          _id: r._id
        }))

        wx.setStorageSync('records', cloudRecords)
        return cloudRecords
      }
    } catch (err) {
      console.log('云端获取失败，使用本地', err)
    }
  }

  const records = wx.getStorageSync('records') || []
  return records.sort((a, b) => new Date(b.createTime) - new Date(a.createTime))
}

async function deleteRecord(id) {
  const records = wx.getStorageSync('records') || []
  const newRecords = records.filter(r => r.id !== id)
  wx.setStorageSync('records', newRecords)

  await _deleteFromCloud('records', id)

  return { success: true }
}

async function updateRecord(id, updates) {
  const records = wx.getStorageSync('records') || []
  const newRecords = records.map(r => {
    if (r.id === id) {
      return { ...r, ...updates, synced: false }
    }
    return r
  })
  wx.setStorageSync('records', newRecords)

  const cloudResult = await _updateInCloud('records', id, {
    routeName: updates.routeName,
    plateNumber: updates.plateNumber,
    sendBlueOut: updates.sendBlueOut || 0,
    sendRedOut: updates.sendRedOut || 0,
    blueOut: updates.blueOut,
    blueIn: updates.blueIn,
    redOut: updates.redOut,
    redIn: updates.redIn,
    remark: updates.remark,
    syncTime: new Date()
  })

  if (cloudResult) {
    const index = newRecords.findIndex(r => r.id === id)
    if (index !== -1) {
      newRecords[index].synced = true
      wx.setStorageSync('records', newRecords)
    }
  }

  return { success: true }
}

async function getRecordById(id) {
  const records = wx.getStorageSync('records') || []
  return records.find(r => r.id === id) || null
}

async function syncRecords() {
  if (!isCloudEnabled || !openid) {
    return {
      success: false,
      message: '未登录云端',
      synced: 0
    }
  }

  try {
    const result = await wx.cloud.callFunction({
      name: 'syncRecords',
      data: {
        action: 'merge',
        localRecords: wx.getStorageSync('records') || []
      }
    })

    if (result.result && result.result.success) {
      const mergedRecords = result.result.mergedRecords
      wx.setStorageSync('records', mergedRecords)

      return {
        success: true,
        synced: mergedRecords.length,
        cloudCount: result.result.cloudCount,
        localCount: result.result.localCount,
        mergedCount: result.result.mergedCount
      }
    }

    return {
      success: false,
      message: '同步失败',
      synced: 0
    }
  } catch (err) {
    console.error('同步失败', err)
    return {
      success: false,
      message: err.message,
      synced: 0
    }
  }
}

function getSyncStatus() {
  const records = wx.getStorageSync('records') || []
  const syncedCount = records.filter(r => r.synced).length
  return {
    total: records.length,
    synced: syncedCount,
    unsynced: records.length - syncedCount,
    isLoggedIn: isCloudEnabled
  }
}

function getPresets() {
  const presets = wx.getStorageSync('presets') || { routes: [], plates: [] }
  return presets
}

function addRoute(routeName) {
  const presets = getPresets()
  if (routeName && !presets.routes.includes(routeName)) {
    presets.routes.push(routeName)
    wx.setStorageSync('presets', presets)
  }
  return presets.routes
}

function addPlate(plateNumber) {
  const presets = getPresets()
  if (plateNumber && !presets.plates.includes(plateNumber)) {
    presets.plates.push(plateNumber)
    wx.setStorageSync('presets', presets)
  }
  return presets.plates
}

function deleteRoute(routeName) {
  const presets = getPresets()
  presets.routes = presets.routes.filter(r => r !== routeName)
  wx.setStorageSync('presets', presets)
  return presets.routes
}

function deletePlate(plateNumber) {
  const presets = getPresets()
  presets.plates = presets.plates.filter(p => p !== plateNumber)
  wx.setStorageSync('presets', presets)
  return presets.plates
}

function clearPresets() {
  wx.setStorageSync('presets', { routes: [], plates: [] })
}

module.exports = {
  initCloud,
  setOpenid,
  getOpenid,
  isLoggedIn,
  setCloudEnabled,
  getCloudEnabled,
  addRecord,
  getTodayRecords,
  getAllRecords,
  deleteRecord,
  updateRecord,
  getRecordById,
  syncRecords,
  getSyncStatus,
  getPresets,
  addRoute,
  addPlate,
  deleteRoute,
  deletePlate,
  clearPresets
}