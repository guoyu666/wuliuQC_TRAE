const util = require('./util.js')
const config = require('./config.js')
const storage = require('./storage.js')
const exporter = require('./exporter.js')

let openid = null
let isCloudEnabled = false
let syncRecordsPromise = null
const CLOUD_FUNCTION_NAME = config.cloud.syncFunctionName
const CLOUD_CACHE_KEY = 'lastCloudFetchAt'
const CLOUD_REPLACE_KEY = 'pendingCloudReplace'
const LAST_SYNC_ERROR_KEY = 'lastSyncError'
const ROUTES_META_KEY = 'routesMeta'
const PLATES_META_KEY = 'platesMeta'
const CLOUD_FETCH_INTERVAL = config.cloud.fetchInterval
const STORAGE_SCHEMA_KEY = 'storageSchemaVersion'
const STORAGE_SCHEMA_VERSION = config.storage.schemaVersion
const CLOUD_PROTOCOL_VERSION = config.cloud.protocolVersion

function safeGetStorageSync(key, fallback) {
  return storage.get(key, fallback)
}

function safeSetStorageSync(key, value) {
  return storage.set(key, value)
}

function setLastSyncError(message = '') {
  safeSetStorageSync(LAST_SYNC_ERROR_KEY, message)
}

function getLastSyncError() {
  return safeGetStorageSync(LAST_SYNC_ERROR_KEY, '')
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
    setLastSyncError('云函数版本过旧，请先部署最新 syncRecords 云函数')
    throw new Error('云函数版本过旧，请先部署最新 syncRecords 云函数')
  }
  if (result.protocolVersion && result.protocolVersion < CLOUD_PROTOCOL_VERSION) {
    setLastSyncError('云函数版本过旧，请先部署最新 syncRecords 云函数')
    throw new Error('云函数版本过旧，请先部署最新 syncRecords 云函数')
  }
  if (result.code === 'PROTOCOL_MISMATCH') {
    setLastSyncError(result.message || '客户端与云函数同步协议不一致')
    throw new Error(result.message || '客户端与云函数同步协议不一致')
  }

  if (result.success !== false) {
    setLastSyncError('')
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

    if (normalized.synced === false && getRecordVersion(normalized) >= getRecordVersion(existing)) {
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

function normalizeDictionaryMeta(meta = {}, list = []) {
  const normalized = {}
  const now = Date.now()

  if (meta && typeof meta === 'object') {
    Object.keys(meta).forEach(name => {
      const key = String(name || '').trim()
      const item = meta[name] || {}
      if (!key) return
      normalized[key] = {
        name: key,
        updatedAt: Number(item.updatedAt || 0),
        deletedAt: Number(item.deletedAt || 0),
        order: Number(item.order || 0)
      }
    })
  }

  normalizeNameList(list).forEach((name, index) => {
    const current = normalized[name] || {}
    if (!current.deletedAt) {
      normalized[name] = {
        name,
        updatedAt: current.updatedAt || now,
        deletedAt: 0,
        order: current.order || index + 1
      }
    }
  })

  return normalized
}

function getDictionaryMeta(metaKey, listKey) {
  return normalizeDictionaryMeta(
    safeGetStorageSync(metaKey, {}),
    safeGetStorageSync(listKey, [])
  )
}

function getVisibleNamesFromMeta(meta) {
  return Object.keys(meta || {})
    .map(name => meta[name])
    .filter(item => item && !item.deletedAt)
    .sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'))
    .map(item => item.name)
}

function saveDictionaryState(listKey, metaKey, list, meta) {
  const visibleList = normalizeNameList(list)
  const normalizedMeta = normalizeDictionaryMeta(meta, visibleList)
  return safeSetStorageSync(listKey, visibleList) && safeSetStorageSync(metaKey, normalizedMeta)
}

function markDictionaryDeleted(listKey, metaKey, name) {
  const trimmed = String(name || '').trim()
  if (!trimmed) return safeGetStorageSync(listKey, [])

  const list = normalizeNameList(safeGetStorageSync(listKey, [])).filter(item => item !== trimmed)
  const meta = getDictionaryMeta(metaKey, listKey)
  const deletedAt = Date.now()
  meta[trimmed] = {
    ...(meta[trimmed] || {}),
    name: trimmed,
    updatedAt: deletedAt,
    deletedAt
  }
  saveDictionaryState(listKey, metaKey, list, meta)
  return list
}

function saveRoutes(routes) {
  const list = normalizeNameList(routes)
  const meta = getDictionaryMeta(ROUTES_META_KEY, 'routes')
  const now = Date.now()
  list.forEach((name, index) => {
    meta[name] = {
      ...(meta[name] || {}),
      name,
      updatedAt: (meta[name] && !meta[name].deletedAt && meta[name].updatedAt) || now,
      deletedAt: 0,
      order: index + 1
    }
  })
  return saveDictionaryState('routes', ROUTES_META_KEY, list, meta)
}

function savePlates(plates) {
  const list = normalizeNameList(plates)
  const meta = getDictionaryMeta(PLATES_META_KEY, 'plates')
  const now = Date.now()
  list.forEach((name, index) => {
    meta[name] = {
      ...(meta[name] || {}),
      name,
      updatedAt: (meta[name] && !meta[name].deletedAt && meta[name].updatedAt) || now,
      deletedAt: 0,
      order: index + 1
    }
  })
  return saveDictionaryState('plates', PLATES_META_KEY, list, meta)
}

function getRoutesMeta() {
  return getDictionaryMeta(ROUTES_META_KEY, 'routes')
}

function getPlatesMeta() {
  return getDictionaryMeta(PLATES_META_KEY, 'plates')
}

function hasLocalSyncWork(records = getStoredRecords()) {
  return records.some(record => record && (record.synced === false || record.deletedAt))
}

function syncDictionariesToCloud(options = {}) {
  if (!isCloudEnabled || !openid) {
    return Promise.resolve({ success: false, message: '未登录云端' })
  }

  const {
    mode = 'merge',
    deletedRoutes = [],
    deletedPlates = []
  } = options

  return callSyncFunction({
    action: 'syncMeta',
    mode,
    routes: getRoutes(),
    plates: getPlates(),
    routesMeta: getRoutesMeta(),
    platesMeta: getPlatesMeta(),
    deletedRoutes,
    deletedPlates
  }).catch(err => {
    console.error('线路车牌同步失败', err)
    setLastSyncError(err.message)
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
      plates: getPlates(),
      routesMeta: getRoutesMeta(),
      platesMeta: getPlatesMeta()
    })

    if (result.success) {
      saveDictionaryState('routes', ROUTES_META_KEY, result.routes || [], result.routesMeta || {})
      saveDictionaryState('plates', PLATES_META_KEY, result.plates || [], result.platesMeta || {})
    }
    return result
  } catch (err) {
    console.error('线路车牌刷新失败', err)
    setLastSyncError(err.message)
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
        setLastSyncError(err.message)
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
    setLastSyncError(err.message)
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
      setLastSyncError(err.message)
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
        if (hasLocalSyncWork(mergedRecords)) {
          syncRecords().catch(err => {
            console.error('后台补同步失败', err)
          })
        }
        return getVisibleRecords(mergedRecords)
      }
    } catch (err) {
      console.log('云端获取失败，使用本地', err)
      setLastSyncError(err.message)
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
      setLastSyncError(err.message)
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
      setLastSyncError(err.message)
    }
  }

  return { success: true }
}

async function getRecordById(id) {
  const records = getStoredRecords()
  return records.find(r => r.id === id) || null
}

async function doSyncRecords() {
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
      action: pendingCloudReplace ? 'restoreAll' : 'merge',
      localRecords: pendingCloudReplace ? getVisibleRecords(getStoredRecords()) : getStoredRecords(),
      routes: pendingCloudReplace ? getRoutes() : undefined,
      plates: pendingCloudReplace ? getPlates() : undefined,
      routesMeta: pendingCloudReplace ? getRoutesMeta() : undefined,
      platesMeta: pendingCloudReplace ? getPlatesMeta() : undefined
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
      if (result.routes || result.routesMeta) {
        saveDictionaryState('routes', ROUTES_META_KEY, result.routes || getRoutes(), result.routesMeta || getRoutesMeta())
      }
      if (result.plates || result.platesMeta) {
        saveDictionaryState('plates', PLATES_META_KEY, result.plates || getPlates(), result.platesMeta || getPlatesMeta())
      }
      setLastCloudFetchAt(Date.now())
      setLastSyncError('')

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
    setLastSyncError(result.message || '同步失败')

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
    setLastSyncError(err.message)
    return {
      success: false,
      message: err.message,
      synced: 0
    }
  }
}

function syncRecords() {
  if (syncRecordsPromise) {
    return syncRecordsPromise
  }

  syncRecordsPromise = doSyncRecords().finally(() => {
    syncRecordsPromise = null
  })
  return syncRecordsPromise
}

function getSyncStatus() {
  const records = getStoredRecords()
  const visibleRecords = getVisibleRecords(records)
  const pendingDeletes = records.length - visibleRecords.length
  const syncedCount = visibleRecords.filter(r => r.synced).length
  const pendingReplace = getPendingCloudReplaceMeta()
  const lastError = getLastSyncError()
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
    lastError,
    protocolError: /云函数|协议|版本/.test(lastError),
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
  const filtered = markDictionaryDeleted('routes', ROUTES_META_KEY, routeName)
  syncDictionariesToCloud({ deletedRoutes: [routeName] })
  return filtered
}

function deletePlate(plateNumber) {
  if (!plateNumber) return []
  const filtered = markDictionaryDeleted('plates', PLATES_META_KEY, plateNumber)
  syncDictionariesToCloud({ deletedPlates: [plateNumber] })
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
    plates,
    routesMeta: getRoutesMeta(),
    platesMeta: getPlatesMeta()
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
      saveDictionaryState('routes', ROUTES_META_KEY, data.routes || [], data.routesMeta || {}) &&
      saveDictionaryState('plates', PLATES_META_KEY, data.plates || [], data.platesMeta || {})
    if (!ok) {
      return { success: false, message: '本地存储失败，请清理空间后重试' }
    }
    setPendingCloudReplace(true, { startedAt: importedAt, failedCount: 0 })
    setLastCloudFetchAt(Date.now())
    return { success: true, message: '恢复成功' }
  } catch (e) {
    return { success: false, message: '解析备份文件失败' }
  }
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
  exportRecordsToCSV: exporter.exportRecordsToCSV,
  exportRecordsToExcel: exporter.exportRecordsToExcel
}
