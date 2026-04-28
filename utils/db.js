const util = require('./util.js')

let openid = null
let isCloudEnabled = false
const CLOUD_FUNCTION_NAME = 'syncRecords'
const CLOUD_CACHE_KEY = 'lastCloudFetchAt'
const CLOUD_REPLACE_KEY = 'pendingCloudReplace'
const CLOUD_FETCH_INTERVAL = 60 * 1000
const STORAGE_SCHEMA_KEY = 'storageSchemaVersion'
const STORAGE_SCHEMA_VERSION = 2
const CLOUD_PROTOCOL_VERSION = 2

function showStorageError(err) {
  console.error('本地存储写入失败', err)
  if (typeof wx !== 'undefined' && wx.showToast) {
    wx.showToast({
      title: '本地存储空间不足或写入失败',
      icon: 'none'
    })
  }
}

function safeGetStorageSync(key, fallback) {
  try {
    const value = wx.getStorageSync(key)
    return value === '' || value === undefined ? fallback : value
  } catch (err) {
    console.error(`读取本地存储失败: ${key}`, err)
    return fallback
  }
}

function safeSetStorageSync(key, value) {
  try {
    wx.setStorageSync(key, value)
    return true
  } catch (err) {
    showStorageError(err)
    return false
  }
}

function parseRecordTime(value) {
  if (!value) return 0

  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isNaN(time) ? 0 : time
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === 'string') {
    const normalized = value.includes(' ') ? value.replace(/-/g, '/').replace('T', ' ') : value
    const parsed = new Date(normalized)
    const time = parsed.getTime()
    return Number.isNaN(time) ? 0 : time
  }

  const parsed = new Date(value)
  const time = parsed.getTime()
  return Number.isNaN(time) ? 0 : time
}

function getRecordVersion(record) {
  return Math.max(
    parseRecordTime(record && record.updatedAt),
    parseRecordTime(record && record.syncTime),
    parseRecordTime(record && record.deletedAt),
    parseRecordTime(record && record.createTime)
  )
}

function getVisibleRecords(records) {
  return records.filter(record => !record.deletedAt)
}

function getStoredRecords() {
  return safeGetStorageSync('records', [])
}

function saveStoredRecords(records) {
  return safeSetStorageSync('records', records)
}

function createRecordId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function getLastCloudFetchAt() {
  return safeGetStorageSync(CLOUD_CACHE_KEY, 0)
}

function setLastCloudFetchAt(timestamp) {
  safeSetStorageSync(CLOUD_CACHE_KEY, timestamp)
}

function hasPendingCloudReplace() {
  const pending = safeGetStorageSync(CLOUD_REPLACE_KEY, null)
  return !!(pending && pending.pending)
}

function getPendingCloudReplaceMeta() {
  const pending = safeGetStorageSync(CLOUD_REPLACE_KEY, null)
  if (!pending || !pending.pending) {
    return null
  }
  return pending
}

function setPendingCloudReplace(pending, meta = {}) {
  if (!pending) {
    safeSetStorageSync(CLOUD_REPLACE_KEY, null)
    return
  }

  const previous = getPendingCloudReplaceMeta() || {}
  safeSetStorageSync(CLOUD_REPLACE_KEY, {
    pending: true,
    startedAt: previous.startedAt || Date.now(),
    failedCount: previous.failedCount || 0,
    lastError: '',
    ...meta
  })
}

function markPendingCloudReplaceFailed(error) {
  const pending = getPendingCloudReplaceMeta()
  if (!pending) return

  setPendingCloudReplace(true, {
    ...pending,
    failedCount: (pending.failedCount || 0) + 1,
    lastError: error || '同步失败',
    lastFailedAt: Date.now()
  })
}

function cancelPendingCloudReplace() {
  setPendingCloudReplace(false)
}

async function callSyncFunction(data = {}) {
  const res = await wx.cloud.callFunction({
    name: CLOUD_FUNCTION_NAME,
    data: {
      protocolVersion: CLOUD_PROTOCOL_VERSION,
      ...data
    }
  })

  const result = res.result || {}
  if (!result.protocolVersion) {
    throw new Error('云函数版本过旧，请先部署最新 syncRecords 云函数')
  }
  if (result.protocolVersion && result.protocolVersion < CLOUD_PROTOCOL_VERSION) {
    throw new Error('云函数版本过旧，请先部署最新 syncRecords 云函数')
  }
  if (result.code === 'PROTOCOL_MISMATCH') {
    throw new Error(result.message || '客户端与云函数同步协议不一致')
  }

  return result
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
    updatedAt: record.updatedAt || getRecordVersion(record) || Date.now(),
    synced: typeof record.synced === 'boolean' ? record.synced : syncedFallback
  }
}

function sortRecords(records) {
  return records.sort((a, b) => getRecordVersion(b) - getRecordVersion(a))
}

function mergeRecords(localRecords, cloudRecords) {
  const mergedMap = new Map()

  cloudRecords.forEach((record, index) => {
    const normalized = normalizeRecord(record, true)
    if (normalized.deletedAt) return
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
      return
    }

    if (getRecordVersion(normalized) > getRecordVersion(existing)) {
      mergedMap.set(key, {
        ...existing,
        ...normalized,
        _id: existing._id || normalized._id,
        synced: true
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
    'remark',
    'updatedAt',
    'deletedAt'
  ]

  fields.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      data[field] = source[field]
    }
  })

  if (includeCreateTime && source.createTime) {
    const timestamp = parseRecordTime(source.createTime)
    const parsed = timestamp ? new Date(timestamp) : new Date()
    data.createTime = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  }

  if (!data.updatedAt) {
    data.updatedAt = Date.now()
  }

  data.syncTime = new Date()
  return data
}

function setOpenid(id) {
  openid = id
  safeSetStorageSync('openid', id)
}

function getOpenid() {
  if (!openid) {
    openid = safeGetStorageSync('openid', '')
  }
  return openid
}

function isLoggedIn() {
  return !!getOpenid() && isCloudEnabled
}

function setCloudEnabled(enabled) {
  isCloudEnabled = enabled
  safeSetStorageSync('cloudEnabled', enabled)
}

function getCloudEnabled() {
  const stored = safeGetStorageSync('cloudEnabled', false)
  if (!stored) {
    return false
  }

  isCloudEnabled = true
  getOpenid()
  return true
}

function normalizeNameList(list) {
  if (!Array.isArray(list)) return []
  return Array.from(new Set(list.map(item => String(item || '').trim()).filter(Boolean)))
}

function saveRoutes(routes) {
  return safeSetStorageSync('routes', normalizeNameList(routes))
}

function savePlates(plates) {
  return safeSetStorageSync('plates', normalizeNameList(plates))
}

function syncDictionariesToCloud() {
  if (!isCloudEnabled || !openid) {
    return Promise.resolve({ success: false, message: '未登录云端' })
  }

  return callSyncFunction({
    action: 'syncMeta',
    mode: 'replace',
    routes: getRoutes(),
    plates: getPlates()
  }).catch(err => {
    console.error('线路车牌同步失败', err)
    return { success: false, message: err.message }
  })
}

async function refreshDictionariesFromCloud() {
  if (!isCloudEnabled || !openid) {
    return { success: false, message: '未登录云端' }
  }

  try {
    const result = await callSyncFunction({
      action: 'syncMeta',
      mode: 'merge',
      routes: getRoutes(),
      plates: getPlates()
    })

    if (result.success) {
      saveRoutes(result.routes || [])
      savePlates(result.plates || [])
    }
    return result
  } catch (err) {
    console.error('线路车牌刷新失败', err)
    return { success: false, message: err.message }
  }
}

function migrateStorageIfNeeded() {
  const currentVersion = safeGetStorageSync(STORAGE_SCHEMA_KEY, 0)
  if (currentVersion >= STORAGE_SCHEMA_VERSION) {
    return { success: true, migrated: false, version: currentVersion }
  }

  const rawRecords = safeGetStorageSync('records', [])
  const migratedRecords = Array.isArray(rawRecords)
    ? sortRecords(rawRecords.map((record, index) => normalizeRecord({
      ...record,
      id: record && (record.id || record._id) || `migrated-${Date.now()}-${index}`,
      synced: typeof (record && record.synced) === 'boolean' ? record.synced : false
    }, false)).filter(Boolean))
    : []
  const migratedRoutes = normalizeNameList(safeGetStorageSync('routes', []))
  const migratedPlates = normalizeNameList(safeGetStorageSync('plates', []))

  const ok = saveStoredRecords(migratedRecords) &&
    saveRoutes(migratedRoutes) &&
    savePlates(migratedPlates) &&
    safeSetStorageSync(STORAGE_SCHEMA_KEY, STORAGE_SCHEMA_VERSION)

  return {
    success: ok,
    migrated: ok,
    version: STORAGE_SCHEMA_VERSION,
    recordCount: migratedRecords.length
  }
}

async function initCloud() {
  try {
    const result = await wx.cloud.callFunction({ name: 'login' })

    if (result.result && result.result.success) {
      openid = result.result.openid
      isCloudEnabled = true
      safeSetStorageSync('openid', openid)
      safeSetStorageSync('cloudEnabled', true)
      console.log('云登录成功', openid)

      try {
        await callSyncFunction({ action: 'protocol' })
        await refreshDictionariesFromCloud()
      } catch (err) {
        console.error('云函数协议检查失败', err)
        isCloudEnabled = false
        safeSetStorageSync('cloudEnabled', false)
        return {
          success: false,
          message: err.message
        }
      }

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
    id: createRecordId(),
    createTime: util.formatTime(new Date()),
    updatedAt: Date.now(),
    synced: false
  }

  localRecords.push(newRecord)
  if (!saveStoredRecords(localRecords)) {
    return { success: false, message: '本地存储失败' }
  }

  if (isCloudEnabled && openid) {
    try {
      const result = await callSyncFunction({
        action: 'upsert',
        record: newRecord
      })

      newRecord.synced = true
      if (result.record && result.record._id) {
        newRecord._id = result.record._id
      }
      const index = localRecords.findIndex(r => r.id === newRecord.id)
      if (index !== -1) {
        localRecords[index] = normalizeRecord({
          ...newRecord,
          ...result.record,
          synced: true
        }, true)
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
  const todayRecords = getVisibleRecords(records).filter(r => r.date === today)
  return todayRecords
}

async function getAllRecords(options = {}) {
  const { forceRefresh = false } = options
  const localRecords = getStoredRecords()
  const shouldUseLocalFirst = localRecords.length > 0
  const lastCloudFetchAt = getLastCloudFetchAt()
  const shouldRefreshCloud = Date.now() - lastCloudFetchAt >= CLOUD_FETCH_INTERVAL

  if (hasPendingCloudReplace()) {
    return getVisibleRecords(sortRecords(localRecords))
  }

  if (isCloudEnabled && openid && (forceRefresh || !shouldUseLocalFirst || shouldRefreshCloud)) {
    try {
      const result = await callSyncFunction({ action: 'download' })

      if (result.success) {
        const cloudRecords = (result.records || []).map(record => normalizeRecord({
          ...record,
          id: record.id || record._id,
          synced: true
        }, true))
        const mergedRecords = mergeRecords(localRecords, cloudRecords)
        if (!saveStoredRecords(mergedRecords)) {
          return getVisibleRecords(sortRecords(localRecords))
        }
        refreshDictionariesFromCloud()
        setLastCloudFetchAt(Date.now())
        return getVisibleRecords(mergedRecords)
      }
    } catch (err) {
      console.log('云端获取失败，使用本地', err)
    }
  }

  return getVisibleRecords(sortRecords(localRecords))
}

async function deleteRecord(id) {
  const records = getStoredRecords()
  const deletingAt = Date.now()
  let newRecords = records.map(r => {
    if (r.id === id) {
      return {
        ...r,
        deletedAt: deletingAt,
        updatedAt: deletingAt,
        synced: false
      }
    }
    return r
  })
  if (!saveStoredRecords(newRecords)) {
    return { success: false, message: '本地存储失败' }
  }

  if (isCloudEnabled && openid) {
    try {
      const deletingRecord = newRecords.find(r => r.id === id)
      const result = await callSyncFunction({
        action: 'delete',
        id,
        record: deletingRecord
      })
      if (result.record && result.skipped) {
        newRecords = getStoredRecords().map(r => {
          if (r.id === id) {
            return normalizeRecord(result.record, true)
          }
          return r
        })
      } else {
        newRecords = getStoredRecords().filter(r => r.id !== id)
      }
      saveStoredRecords(newRecords)
    } catch (err) {
      console.error('云端删除失败', err)
    }
  } else {
    newRecords = records.filter(r => r.id !== id)
    saveStoredRecords(newRecords)
  }

  return { success: true }
}

async function updateRecord(id, updates) {
  const records = getStoredRecords()
  const newRecords = records.map(r => {
    if (r.id === id) {
      return { ...r, ...updates, updatedAt: Date.now(), synced: false }
    }
    return r
  })
  if (!saveStoredRecords(newRecords)) {
    return { success: false, message: '本地存储失败' }
  }

  if (isCloudEnabled && openid) {
    try {
      const updatedRecord = newRecords.find(r => r.id === id)
      if (updatedRecord) {
        const result = await callSyncFunction({
          action: 'upsert',
          record: updatedRecord
        })
        const index = newRecords.findIndex(r => r.id === id)
        if (index !== -1) {
          newRecords[index] = normalizeRecord({
            ...newRecords[index],
            ...(result.record || {}),
            synced: true
          }, true)
          saveStoredRecords(newRecords)
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
    const pendingCloudReplace = hasPendingCloudReplace()
    const result = await callSyncFunction({
      action: pendingCloudReplace ? 'replace' : 'merge',
      localRecords: pendingCloudReplace ? getVisibleRecords(getStoredRecords()) : getStoredRecords()
    })

    if (result.success) {
      const mergedRecords = sortRecords((result.mergedRecords || []).map(record => normalizeRecord(record, true)))

      if (!saveStoredRecords(mergedRecords)) {
        return {
          success: false,
          message: '本地存储失败，请清理空间后重试',
          synced: 0
        }
      }
      if (!pendingCloudReplace || !result.failedCount) {
        setPendingCloudReplace(false)
      } else {
        markPendingCloudReplaceFailed('部分记录上传失败')
      }
      setLastCloudFetchAt(Date.now())

      return {
        success: true,
        synced: mergedRecords.length,
        cloudCount: result.cloudCount,
        localCount: result.localCount,
        mergedCount: result.mergedCount
      }
    }

    if (pendingCloudReplace) {
      markPendingCloudReplaceFailed(result.message || '恢复同步失败')
    }

    return {
      success: false,
      message: result.message || '同步失败',
      synced: 0
    }
  } catch (err) {
    console.error('同步失败', err)
    if (hasPendingCloudReplace()) {
      markPendingCloudReplaceFailed(err.message)
    }
    return {
      success: false,
      message: err.message,
      synced: 0
    }
  }
}

function getSyncStatus() {
  const records = getStoredRecords()
  const visibleRecords = getVisibleRecords(records)
  const pendingDeletes = records.length - visibleRecords.length
  const syncedCount = visibleRecords.filter(r => r.synced).length
  const pendingReplace = getPendingCloudReplaceMeta()
  return {
    total: visibleRecords.length,
    visibleTotal: visibleRecords.length,
    pendingDeletes,
    synced: syncedCount,
    unsynced: visibleRecords.length - syncedCount,
    pendingCloudReplace: !!pendingReplace,
    pendingCloudReplaceAt: pendingReplace && pendingReplace.startedAt,
    pendingCloudReplaceFailedCount: pendingReplace ? pendingReplace.failedCount || 0 : 0,
    pendingCloudReplaceLastError: pendingReplace && pendingReplace.lastError || '',
    isLoggedIn: isCloudEnabled
  }
}

function getRoutes() {
  return safeGetStorageSync('routes', [])
}

function addRoute(routeName) {
  if (!routeName || !routeName.trim()) return []
  const routes = safeGetStorageSync('routes', [])
  const trimmed = routeName.trim()
  if (!routes.includes(trimmed)) {
    routes.push(trimmed)
    saveRoutes(routes)
    syncDictionariesToCloud()
  }
  return routes
}

function getPlates() {
  return safeGetStorageSync('plates', [])
}

function addPlate(plateNumber) {
  if (!plateNumber || !plateNumber.trim()) return []
  const plates = safeGetStorageSync('plates', [])
  const trimmed = plateNumber.trim()
  if (!plates.includes(trimmed)) {
    plates.push(trimmed)
    savePlates(plates)
    syncDictionariesToCloud()
  }
  return plates
}

function deleteRoute(routeName) {
  if (!routeName) return []
  const routes = safeGetStorageSync('routes', [])
  const filtered = routes.filter(r => r !== routeName)
  saveRoutes(filtered)
  syncDictionariesToCloud()
  return filtered
}

function deletePlate(plateNumber) {
  if (!plateNumber) return []
  const plates = safeGetStorageSync('plates', [])
  const filtered = plates.filter(p => p !== plateNumber)
  savePlates(filtered)
  syncDictionariesToCloud()
  return filtered
}

function exportAllData() {
  const records = getStoredRecords()
  const routes = safeGetStorageSync('routes', [])
  const plates = safeGetStorageSync('plates', [])
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
    const importedAt = Date.now()
    const importedRecords = (data.records || []).map((record, index) => normalizeRecord({
      ...record,
      id: record.id || record._id || `${importedAt}-${index}`,
      updatedAt: importedAt,
      synced: false
    }, false))
    const ok = saveStoredRecords(sortRecords(importedRecords)) &&
      saveRoutes(data.routes || []) &&
      savePlates(data.plates || [])
    if (!ok) {
      return { success: false, message: '本地存储失败，请清理空间后重试' }
    }
    setPendingCloudReplace(true, { startedAt: importedAt, failedCount: 0 })
    syncDictionariesToCloud()
    setLastCloudFetchAt(Date.now())
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

function escapeExcelXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function encodeUtf8(str) {
  const bytes = []
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i)
    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1)
      if (next >= 0xDC00 && next <= 0xDFFF) {
        code = 0x10000 + ((code - 0xD800) << 10) + (next - 0xDC00)
        i++
      }
    }

    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F))
    } else if (code < 0x10000) {
      bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F))
    } else {
      bytes.push(0xF0 | (code >> 18), 0x80 | ((code >> 12) & 0x3F), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F))
    }
  }
  return new Uint8Array(bytes)
}

function getCrc32(bytes) {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function writeUint16(bytes, value) {
  bytes.push(value & 0xFF, (value >>> 8) & 0xFF)
}

function writeUint32(bytes, value) {
  bytes.push(value & 0xFF, (value >>> 8) & 0xFF, (value >>> 16) & 0xFF, (value >>> 24) & 0xFF)
}

function createZip(files) {
  const output = []
  const centralDirectory = []
  let offset = 0

  files.forEach(file => {
    const nameBytes = encodeUtf8(file.name)
    const dataBytes = encodeUtf8(file.content)
    const crc32 = getCrc32(dataBytes)

    writeUint32(output, 0x04034B50)
    writeUint16(output, 20)
    writeUint16(output, 0x0800)
    writeUint16(output, 0)
    writeUint16(output, 0)
    writeUint16(output, 0)
    writeUint32(output, crc32)
    writeUint32(output, dataBytes.length)
    writeUint32(output, dataBytes.length)
    writeUint16(output, nameBytes.length)
    writeUint16(output, 0)
    output.push(...nameBytes, ...dataBytes)

    writeUint32(centralDirectory, 0x02014B50)
    writeUint16(centralDirectory, 20)
    writeUint16(centralDirectory, 20)
    writeUint16(centralDirectory, 0x0800)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint32(centralDirectory, crc32)
    writeUint32(centralDirectory, dataBytes.length)
    writeUint32(centralDirectory, dataBytes.length)
    writeUint16(centralDirectory, nameBytes.length)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint32(centralDirectory, 0)
    writeUint32(centralDirectory, offset)
    centralDirectory.push(...nameBytes)

    offset = output.length
  })

  const centralDirectoryOffset = output.length
  output.push(...centralDirectory)

  writeUint32(output, 0x06054B50)
  writeUint16(output, 0)
  writeUint16(output, 0)
  writeUint16(output, files.length)
  writeUint16(output, files.length)
  writeUint32(output, centralDirectory.length)
  writeUint32(output, centralDirectoryOffset)
  writeUint16(output, 0)

  return new Uint8Array(output).buffer
}

function toExcelColumn(index) {
  let column = ''
  let n = index + 1
  while (n > 0) {
    const remainder = (n - 1) % 26
    column = String.fromCharCode(65 + remainder) + column
    n = Math.floor((n - 1) / 26)
  }
  return column
}

function exportRecordsToExcel(records) {
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

  const buildCell = (cell, rowIndex, columnIndex) => {
    const ref = `${toExcelColumn(columnIndex)}${rowIndex}`
    if (typeof cell === 'number') {
      return `<c r="${ref}"><v>${cell}</v></c>`
    }
    return `<c r="${ref}" t="inlineStr"><is><t>${escapeExcelXml(cell)}</t></is></c>`
  }

  const sheetRows = [headers, ...rows].map((row, rowIndex) => {
    const excelRowIndex = rowIndex + 1
    return `<row r="${excelRowIndex}">${row.map((cell, columnIndex) => buildCell(cell, excelRowIndex, columnIndex)).join('')}</row>`
  }).join('')

  const files = [
    {
      name: '[Content_Types].xml',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'
    },
    {
      name: '_rels/.rels',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    },
    {
      name: 'xl/workbook.xml',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="历史记录" sheetId="1" r:id="rId1"/></sheets></workbook>'
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
    },
    {
      name: 'xl/styles.xml',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>'
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
    }
  ]

  return createZip(files)
}

module.exports = {
  initCloud,
  migrateStorageIfNeeded,
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
  refreshDictionariesFromCloud,
  getSyncStatus,
  cancelPendingCloudReplace,
  getRoutes,
  addRoute,
  getPlates,
  addPlate,
  deleteRoute,
  deletePlate,
  exportAllData,
  importAllData,
  exportRecordsToCSV,
  exportRecordsToExcel
}
