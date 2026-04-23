const util = require('./util.js')

let openid = null
let isCloudEnabled = false
const CLOUD_FUNCTION_NAME = 'syncRecords'
const CLOUD_CACHE_KEY = 'lastCloudFetchAt'
const CLOUD_FETCH_INTERVAL = 60 * 1000

function getStoredRecords() {
  return wx.getStorageSync('records') || []
}

function saveStoredRecords(records) {
  wx.setStorageSync('records', records)
}

function getLastCloudFetchAt() {
  return wx.getStorageSync(CLOUD_CACHE_KEY) || 0
}

function setLastCloudFetchAt(timestamp) {
  wx.setStorageSync(CLOUD_CACHE_KEY, timestamp)
}

function formatRecordTime(value) {
  if (!value) return ''

  if (typeof value === 'string') {
    return value
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return ''
  }

  return util.formatTime(parsed)
}

function normalizeRecord(record, syncedFallback = false) {
  if (!record) return null

  return {
    ...record,
    createTime: formatRecordTime(record.createTime),
    synced: typeof record.synced === 'boolean' ? record.synced : syncedFallback
  }
}

function sortRecords(records) {
  return records.sort((a, b) => new Date(b.createTime) - new Date(a.createTime))
}

function mergeRecords(localRecords, cloudRecords) {
  const mergedMap = new Map()

  cloudRecords.forEach((record, index) => {
    const normalized = normalizeRecord(record, true)
    const key = normalized.id || normalized._id || `cloud-${index}`
    mergedMap.set(key, normalized)
  })

  localRecords.forEach((record, index) => {
    const normalized = normalizeRecord(record, false)
    const key = normalized.id || normalized._id || `local-${index}`
    const existing = mergedMap.get(key)

    if (!existing) {
      mergedMap.set(key, normalized)
      return
    }

    if (normalized.synced === false) {
      mergedMap.set(key, {
        ...existing,
        ...normalized,
        _id: existing._id || normalized._id,
        synced: false
      })
    }
  })

  return sortRecords(Array.from(mergedMap.values()))
}

function buildCloudUpdateData(source, includeCreateTime = false) {
  const data = {}
  const fields = [
    'id',
    'date',
    'routeName',
    'plateNumber',
    'sendBlueOut',
    'sendRedOut',
    'blueOut',
    'blueIn',
    'redOut',
    'redIn',
    'remark'
  ]

  fields.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      data[field] = source[field]
    }
  })

  if (includeCreateTime && source.createTime) {
    const parsed = new Date(source.createTime)
    data.createTime = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  }

  data.syncTime = new Date()
  return data
}

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
  const stored = wx.getStorageSync('cloudEnabled')
  if (!stored) {
    return false
  }

  isCloudEnabled = true
  return true
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
  const localRecords = getStoredRecords()
  const newRecord = {
    ...record,
    id: Date.now().toString(),
    createTime: util.formatTime(new Date()),
    synced: false
  }

  localRecords.push(newRecord)
  saveStoredRecords(localRecords)

  if (isCloudEnabled && openid) {
    try {
      const db = wx.cloud.database()
      await db.collection('records').add({
        data: {
          _openid: openid,
          ...buildCloudUpdateData(newRecord, true)
        }
      })

      newRecord.synced = true
      const index = localRecords.findIndex(r => r.id === newRecord.id)
      if (index !== -1) {
        localRecords[index] = newRecord
        saveStoredRecords(localRecords)
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
  const records = getStoredRecords()
  const todayRecords = records.filter(r => r.date === today)
  return todayRecords
}

async function getAllRecords(options = {}) {
  const { forceRefresh = false } = options
  const localRecords = getStoredRecords()
  const shouldUseLocalFirst = localRecords.length > 0
  const lastCloudFetchAt = getLastCloudFetchAt()
  const shouldRefreshCloud = Date.now() - lastCloudFetchAt >= CLOUD_FETCH_INTERVAL

  if (isCloudEnabled && openid && (forceRefresh || !shouldUseLocalFirst || shouldRefreshCloud)) {
    try {
      const res = await wx.cloud.callFunction({
        name: CLOUD_FUNCTION_NAME,
        data: {
          action: 'download'
        }
      })

      if (res.result && res.result.success) {
        const cloudRecords = (res.result.records || []).map(record => normalizeRecord({
          ...record,
          id: record.id || record._id,
          synced: true
        }, true))
        const mergedRecords = mergeRecords(localRecords, cloudRecords)
        saveStoredRecords(mergedRecords)
        setLastCloudFetchAt(Date.now())
        return mergedRecords
      }
    } catch (err) {
      console.log('云端获取失败，使用本地', err)
    }
  }

  return sortRecords(localRecords)
}

async function deleteRecord(id) {
  const records = getStoredRecords()
  const newRecords = records.filter(r => r.id !== id)
  saveStoredRecords(newRecords)

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
  const records = getStoredRecords()
  const newRecords = records.map(r => {
    if (r.id === id) {
      return { ...r, ...updates, synced: false }
    }
    return r
  })
  saveStoredRecords(newRecords)

  if (isCloudEnabled && openid) {
    try {
      const db = wx.cloud.database()
      const cloudRecords = await db.collection('records')
        .where({
          _openid: openid,
          id: id
        })
        .get()

      const cloudData = buildCloudUpdateData(updates)

      if (cloudRecords.data && cloudRecords.data.length > 0) {
        await db.collection('records').doc(cloudRecords.data[0]._id).update({
          data: cloudData
        })

        const index = newRecords.findIndex(r => r.id === id)
        if (index !== -1) {
          newRecords[index].synced = true
          saveStoredRecords(newRecords)
        }
      } else {
        const recordToCreate = newRecords.find(r => r.id === id)
        if (recordToCreate) {
          await db.collection('records').add({
            data: {
              _openid: openid,
              ...buildCloudUpdateData(recordToCreate, true)
            }
          })

          const index = newRecords.findIndex(r => r.id === id)
          if (index !== -1) {
            newRecords[index].synced = true
            saveStoredRecords(newRecords)
          }
        }
      }
    } catch (err) {
      console.error('云端更新失败', err)
    }
  }

  return { success: true }
}

async function getRecordById(id) {
  const records = getStoredRecords()
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
        localRecords: getStoredRecords()
      }
    })

    if (result.result && result.result.success) {
      const mergedRecords = (result.result.mergedRecords || []).map(record => normalizeRecord(record, true))

      saveStoredRecords(mergedRecords)

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
  const records = getStoredRecords()
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
  const records = getStoredRecords()
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

function exportRecordsToCSV(records) {
  const headers = ['日期', '线路', '车牌', '物流蓝出', '物流红出', '蓝发出', '蓝收回', '红发出', '红收回', '备注', '创建时间']
  const rows = records.map(r => [
    r.date || '',
    r.routeName || '',
    r.plateNumber || '',
    r.sendBlueOut || 0,
    r.sendRedOut || 0,
    r.blueOut || 0,
    r.blueIn || 0,
    r.redOut || 0,
    r.redIn || 0,
    r.remark || '',
    r.createTime || ''
  ])
  
  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  
  return `\uFEFF${csvContent}`
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
  importAllData,
  exportRecordsToCSV
}
