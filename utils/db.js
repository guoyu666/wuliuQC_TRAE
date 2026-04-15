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

  if (isCloudEnabled && openid) {
    try {
      const db = wx.cloud.database()
      await db.collection('records').add({
        data: {
          _openid: openid,
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
          createTime: new Date(newRecord.createTime),
          syncTime: new Date()
        }
      })

      newRecord.synced = true
      const index = localRecords.findIndex(r => r.id === newRecord.id)
      if (index !== -1) {
        localRecords[index] = newRecord
        wx.setStorageSync('records', localRecords)
      }

      return { success: true, id: newRecord.id, synced: true }
    } catch (err) {
      console.error('云端同步失败', err)
      return { success: true, id: newRecord.id, synced: false }
    }
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

  if (isCloudEnabled && openid) {
    try {
      const db = wx.cloud.database()
      const cloudRecords = await db.collection('records')
        .where({
          _openid: openid,
          id: id
        })
        .get()

      if (cloudRecords.data && cloudRecords.data.length > 0) {
        await db.collection('records').doc(cloudRecords.data[0]._id).remove()
      }
    } catch (err) {
      console.error('云端删除失败', err)
    }
  }

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

  if (isCloudEnabled && openid) {
    try {
      const db = wx.cloud.database()
      const cloudRecords = await db.collection('records')
        .where({
          _openid: openid,
          id: id
        })
        .get()

      if (cloudRecords.data && cloudRecords.data.length > 0) {
        await db.collection('records').doc(cloudRecords.data[0]._id).update({
          data: {
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
          }
        })

        const index = newRecords.findIndex(r => r.id === id)
        if (index !== -1) {
          newRecords[index].synced = true
          wx.setStorageSync('records', newRecords)
        }
      }
    } catch (err) {
      console.error('云端更新失败', err)
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

function getRoutes() {
  return wx.getStorageSync('routes') || []
}

function addRoute(routeName) {
  if (!routeName || !routeName.trim()) return []
  const routes = wx.getStorageSync('routes') || []
  const trimmed = routeName.trim()
  if (!routes.includes(trimmed)) {
    routes.push(trimmed)
    wx.setStorageSync('routes', routes)
  }
  return routes
}

function getPlates() {
  return wx.getStorageSync('plates') || []
}

function addPlate(plateNumber) {
  if (!plateNumber || !plateNumber.trim()) return []
  const plates = wx.getStorageSync('plates') || []
  const trimmed = plateNumber.trim()
  if (!plates.includes(trimmed)) {
    plates.push(trimmed)
    wx.setStorageSync('plates', plates)
  }
  return plates
}

function deleteRoute(routeName) {
  if (!routeName) return []
  const routes = wx.getStorageSync('routes') || []
  const filtered = routes.filter(r => r !== routeName)
  wx.setStorageSync('routes', filtered)
  return filtered
}

function deletePlate(plateNumber) {
  if (!plateNumber) return []
  const plates = wx.getStorageSync('plates') || []
  const filtered = plates.filter(p => p !== plateNumber)
  wx.setStorageSync('plates', filtered)
  return filtered
}

function exportAllData() {
  const records = wx.getStorageSync('records') || []
  const routes = wx.getStorageSync('routes') || []
  const plates = wx.getStorageSync('plates') || []
  const backupData = {
    version: '1.0',
    timestamp: new Date().toISOString(),
    records,
    routes,
    plates
  }
  return JSON.stringify(backupData, null, 2)
}

function importAllData(jsonStr) {
  try {
    const data = JSON.parse(jsonStr)
    if (!data.version || !data.records) {
      return { success: false, message: '无效的备份文件格式' }
    }
    wx.setStorageSync('records', data.records || [])
    wx.setStorageSync('routes', data.routes || [])
    wx.setStorageSync('plates', data.plates || [])
    return { success: true, message: '恢复成功' }
  } catch (e) {
    return { success: false, message: '解析备份文件失败' }
  }
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
  getRoutes,
  addRoute,
  getPlates,
  addPlate,
  deleteRoute,
  deletePlate,
  exportAllData,
  importAllData
}