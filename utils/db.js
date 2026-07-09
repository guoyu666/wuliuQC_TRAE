const util = require('./util.js')
const config = require('./config.js')
const storage = require('./storage.js')
const exporter = require('./exporter.js')
const backup = require('./backup.js')

let openid = null
let isCloudEnabled = false
let syncRecordsPromise = null
const CLOUD_FUNCTION_NAME = config.cloud.syncFunctionName
const CLOUD_CACHE_KEY = 'lastCloudFetchAt'
const CLOUD_CURSOR_KEY = 'lastCloudCursorAt'
const CLOUD_CURSOR_OVERLAP = config.cloud.cursorOverlap || 3000
const CLOUD_REPLACE_KEY = 'pendingCloudReplace'
const LAST_SYNC_ERROR_KEY = 'lastSyncError'
const LAST_SYNC_META_KEY = 'lastSyncMeta'
const ROUTES_META_KEY = 'routesMeta'
const PLATES_META_KEY = 'platesMeta'
const CLOUD_FETCH_INTERVAL = config.cloud.fetchInterval
const STORAGE_SCHEMA_KEY = 'storageSchemaVersion'
const STORAGE_SCHEMA_VERSION = config.storage.schemaVersion
const CLOUD_PROTOCOL_VERSION = config.cloud.protocolVersion
const RESTORE_CHUNK_SIZE = config.cloud.restoreChunkSize || 50
const ACTIVE_OPENID_KEY = 'activeOpenid'
const USER_PROFILE_KEY = 'userProfile'
const LEGACY_DATA_CLAIMED_BY_KEY = 'legacyDataClaimedBy'
const USER_SCOPED_KEYS = new Set([
  'records',
  'routes',
  'plates',
  ROUTES_META_KEY,
  PLATES_META_KEY,
  CLOUD_CACHE_KEY,
  CLOUD_CURSOR_KEY,
  CLOUD_REPLACE_KEY,
  LAST_SYNC_ERROR_KEY,
  LAST_SYNC_META_KEY,
  STORAGE_SCHEMA_KEY,
  USER_PROFILE_KEY
])
const AUTH_STATUS = {
  UNAUTHORIZED: 'unauthorized',
  CHECKING: 'checking',
  AUTHORIZED: 'authorized',
  CLOUD_UNAVAILABLE: 'cloudUnavailable'
}
let authState = AUTH_STATUS.UNAUTHORIZED

function getScopedStorageKey(key) {
  if (!USER_SCOPED_KEYS.has(key)) {
    return key
  }

  const accountId = openid || storage.get(ACTIVE_OPENID_KEY, '')
  return accountId ? `user:${accountId}:${key}` : key
}

function rawGetStorageSync(key, fallback) {
  return storage.get(key, fallback)
}

function rawSetStorageSync(key, value) {
  return storage.set(key, value)
}

function safeGetStorageSync(key, fallback) {
  return storage.get(getScopedStorageKey(key), fallback)
}

function safeSetStorageSync(key, value) {
  return storage.set(getScopedStorageKey(key), value)
}

function setLastSyncError(message = '') {
  safeSetStorageSync(LAST_SYNC_ERROR_KEY, message)
}

function getLastSyncError() {
  return safeGetStorageSync(LAST_SYNC_ERROR_KEY, '')
}

function setLastSyncMeta(meta = {}) {
  safeSetStorageSync(LAST_SYNC_META_KEY, {
    ...getLastSyncMeta(),
    ...meta,
    updatedAt: Date.now()
  })
}

function getLastSyncMeta() {
  return safeGetStorageSync(LAST_SYNC_META_KEY, {})
}

function formatMetaTime(timestamp) {
  if (!timestamp) return '从未同步'
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return '从未同步'
  return util.formatTime(parsed)
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

function getMaxRecordVersion(records = []) {
  return records.reduce((max, record) => Math.max(max, getRecordVersion(record)), 0)
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

function getLastCloudCursorAt() {
  return safeGetStorageSync(CLOUD_CURSOR_KEY, 0)
}

function setLastCloudCursorAt(timestamp) {
  const normalized = Math.max(0, Number(timestamp || 0) - CLOUD_CURSOR_OVERLAP)
  safeSetStorageSync(CLOUD_CURSOR_KEY, normalized)
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

function mergeRecords(localRecords, cloudRecords, options = {}) {
  const { fullCloudSnapshot = false } = options
  const mergedMap = new Map()

  cloudRecords.forEach((record, index) => {
    const normalized = normalizeRecord(record, true)
    const key = normalized.id || normalized._id || `cloud-${index}`
    const existing = mergedMap.get(key)
    if (!existing || getRecordVersion(normalized) >= getRecordVersion(existing)) {
      mergedMap.set(key, normalized)
    }
  })

  localRecords.forEach((record, index) => {
    const normalized = normalizeRecord(record, false)
    const key = normalized.id || normalized._id || `local-${index}`
    const existing = mergedMap.get(key)

    if (!existing) {
      if (!fullCloudSnapshot || normalized.synced === false || normalized.deletedAt) {
        mergedMap.set(key, normalized)
      }
      return
    }

    if (existing.deletedAt) {
      if (normalized.synced === false && getRecordVersion(normalized) > getRecordVersion(existing)) {
        mergedMap.set(key, {
          ...existing,
          ...normalized,
          _id: existing._id || normalized._id,
          synced: false
        })
      }
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
  rawSetStorageSync('openid', id)
  rawSetStorageSync(ACTIVE_OPENID_KEY, id)
}

function getOpenid() {
  if (!openid) {
    openid = rawGetStorageSync('openid', '') || rawGetStorageSync(ACTIVE_OPENID_KEY, '')
  }
  return openid
}

function isLoggedIn() {
  return !!getOpenid() && authState === AUTH_STATUS.AUTHORIZED && isCloudEnabled
}

function setCloudEnabled(enabled) {
  isCloudEnabled = enabled
  authState = enabled
    ? AUTH_STATUS.AUTHORIZED
    : (hasAuthorizedLogin() ? AUTH_STATUS.CLOUD_UNAVAILABLE : AUTH_STATUS.UNAUTHORIZED)
  rawSetStorageSync('cloudEnabled', enabled)
}

function getCloudEnabled() {
  const stored = rawGetStorageSync('cloudEnabled', false)
  const storedOpenid = rawGetStorageSync('openid', '') || rawGetStorageSync(ACTIVE_OPENID_KEY, '')
  if (!stored || !storedOpenid) {
    isCloudEnabled = false
    authState = storedOpenid ? AUTH_STATUS.CLOUD_UNAVAILABLE : AUTH_STATUS.UNAUTHORIZED
    return false
  }

  openid = storedOpenid
  if (authState === AUTH_STATUS.UNAUTHORIZED) {
    authState = AUTH_STATUS.CHECKING
  }
  rawSetStorageSync(ACTIVE_OPENID_KEY, storedOpenid)
  return authState === AUTH_STATUS.AUTHORIZED && isCloudEnabled
}

function hasAuthorizedLogin() {
  return !!(rawGetStorageSync('openid', '') || rawGetStorageSync(ACTIVE_OPENID_KEY, ''))
}

function getAuthStatus() {
  if (!hasAuthorizedLogin()) {
    authState = AUTH_STATUS.UNAUTHORIZED
    return AUTH_STATUS.UNAUTHORIZED
  }
  if (authState === AUTH_STATUS.UNAUTHORIZED) {
    authState = AUTH_STATUS.CHECKING
  }
  return authState
}

function restoreLoginState() {
  if (!hasAuthorizedLogin()) {
    isCloudEnabled = false
    openid = null
    return false
  }

  openid = rawGetStorageSync('openid', '') || rawGetStorageSync(ACTIVE_OPENID_KEY, '')
  rawSetStorageSync('openid', openid)
  isCloudEnabled = false
  authState = AUTH_STATUS.CHECKING
  rawSetStorageSync(ACTIVE_OPENID_KEY, openid)
  return true
}

function saveUserProfile(userInfo = {}) {
  const profile = {
    nickName: userInfo.nickName || userInfo.nickname || '微信用户',
    avatarUrl: userInfo.avatarUrl || '',
    updatedAt: Date.now()
  }
  safeSetStorageSync(USER_PROFILE_KEY, profile)
  return profile
}

function getUserProfile() {
  return safeGetStorageSync(USER_PROFILE_KEY, null)
}

function clearUserProfile() {
  safeSetStorageSync(USER_PROFILE_KEY, null)
}

function claimLegacyDataForAccount() {
  if (!openid) return

  const claimedBy = rawGetStorageSync(LEGACY_DATA_CLAIMED_BY_KEY, '')
  if (claimedBy && claimedBy !== openid) {
    return
  }

  const legacyKeys = [
    'records',
    'routes',
    'plates',
    ROUTES_META_KEY,
    PLATES_META_KEY,
    CLOUD_CACHE_KEY,
    CLOUD_CURSOR_KEY,
    CLOUD_REPLACE_KEY,
    LAST_SYNC_ERROR_KEY,
    LAST_SYNC_META_KEY,
    STORAGE_SCHEMA_KEY
  ]
  let claimed = false

  legacyKeys.forEach(key => {
    const legacyValue = rawGetStorageSync(key, undefined)
    if (legacyValue === undefined || legacyValue === '') return

    const scopedKey = getScopedStorageKey(key)
    const scopedValue = rawGetStorageSync(scopedKey, undefined)
    if (scopedValue === undefined || scopedValue === '') {
      rawSetStorageSync(scopedKey, legacyValue)
      claimed = true
    }
  })

  if (claimed || !claimedBy) {
    rawSetStorageSync(LEGACY_DATA_CLAIMED_BY_KEY, openid)
  }
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

async function initCloud(userInfo = {}) {
  if (hasAuthorizedLogin()) {
    authState = AUTH_STATUS.CHECKING
  }

  try {
    const result = await wx.cloud.callFunction({
      name: 'login',
      data: {
        userInfo
      }
    })

    if (result.result && result.result.success) {
      openid = result.result.openid
      isCloudEnabled = false
      authState = AUTH_STATUS.CHECKING
      rawSetStorageSync('openid', openid)
      rawSetStorageSync(ACTIVE_OPENID_KEY, openid)
      const profile = saveUserProfile(result.result.userInfo || userInfo)
      claimLegacyDataForAccount()
      migrateStorageIfNeeded()

      try {
        await callSyncFunction({ action: 'protocol' })
        await refreshDictionariesFromCloud()
      } catch (err) {
        console.error('云函数协议检查失败', err)
        isCloudEnabled = false
        authState = AUTH_STATUS.CLOUD_UNAVAILABLE
        rawSetStorageSync('cloudEnabled', false)
        setLastSyncError(err.message)
        return {
          success: false,
          message: err.message
        }
      }

      isCloudEnabled = true
      authState = AUTH_STATUS.AUTHORIZED
      rawSetStorageSync('cloudEnabled', true)

      return {
        success: true,
        openid: openid,
        isNewUser: result.result.isNewUser,
        userInfo: profile
      }
    }

    isCloudEnabled = false
    authState = hasAuthorizedLogin() ? AUTH_STATUS.CLOUD_UNAVAILABLE : AUTH_STATUS.UNAUTHORIZED
    rawSetStorageSync('cloudEnabled', false)
    return {
      success: false,
      message: '登录失败'
    }
  } catch (err) {
    console.error('云登录失败', err)
    isCloudEnabled = false
    authState = hasAuthorizedLogin() ? AUTH_STATUS.CLOUD_UNAVAILABLE : AUTH_STATUS.UNAUTHORIZED
    rawSetStorageSync('cloudEnabled', false)
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
  const lastCloudCursorAt = getLastCloudCursorAt()
  const shouldRefreshCloud = Date.now() - lastCloudFetchAt >= CLOUD_FETCH_INTERVAL

  if (hasPendingCloudReplace()) {
    return getVisibleRecords(sortRecords(localRecords))
  }

  if (isCloudEnabled && openid && (forceRefresh || !shouldUseLocalFirst || shouldRefreshCloud)) {
    try {
      const shouldUseIncremental = !forceRefresh && shouldUseLocalFirst && lastCloudCursorAt > 0
      const result = await callSyncFunction(shouldUseIncremental
        ? { action: 'downloadChanges', since: lastCloudCursorAt }
        : { action: 'download' })

      if (result.success) {
        const cloudRecords = (result.records || []).map(record => normalizeRecord({
          ...record,
          id: record.id || record._id,
          synced: true
        }, true))
        const mergedRecords = mergeRecords(localRecords, cloudRecords, {
          fullCloudSnapshot: !shouldUseIncremental
        })
        if (!saveStoredRecords(mergedRecords)) {
          return getVisibleRecords(sortRecords(localRecords))
        }
        refreshDictionariesFromCloud()
        setLastCloudFetchAt(Date.now())
        setLastCloudCursorAt(result.cursorAt || getMaxRecordVersion(cloudRecords) || Date.now())
        if (hasLocalSyncWork(mergedRecords)) {
          syncRecords().catch(err => {
            console.error('后台补同步失败', err)
          })
        }
        return getVisibleRecords(mergedRecords)
      }
    } catch (err) {
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

async function syncPendingCloudReplace() {
  const localRecords = getVisibleRecords(getStoredRecords())
  const startResult = await callSyncFunction({
    action: 'restoreStart',
    localCount: localRecords.length
  })

  if (!startResult.success) {
    return startResult
  }

  const restoreBatchId = startResult.restoreBatchId
  const restoreJobId = startResult.restoreJobId || ''
  const uploadedRecords = []
  let failedCount = 0

  setPendingCloudReplace(true, {
    restoreBatchId,
    restoreJobId,
    uploadedCount: 0
  })

  for (let offset = 0; offset < localRecords.length; offset += RESTORE_CHUNK_SIZE) {
    const chunk = localRecords.slice(offset, offset + RESTORE_CHUNK_SIZE)
    const chunkResult = await callSyncFunction({
      action: 'restoreChunk',
      restoreBatchId,
      restoreJobId,
      offset,
      localRecords: chunk
    })

    if (!chunkResult.success) {
      throw new Error(chunkResult.message || '恢复分片上传失败')
    }

    failedCount += chunkResult.failedCount || 0
    uploadedRecords.push(...(chunkResult.uploadedRecords || []))
    setPendingCloudReplace(true, {
      restoreBatchId,
      restoreJobId,
      uploadedCount: uploadedRecords.length,
      failedCount
    })
  }

  if (failedCount > 0) {
    await callSyncFunction({
      action: 'restoreAbort',
      restoreBatchId,
      restoreJobId,
      reason: '部分记录上传失败'
    }).catch(() => {})
    return {
      success: false,
      message: '恢复数据上传不完整，已保留原云端数据',
      mergedRecords: uploadedRecords,
      failedCount
    }
  }

  return callSyncFunction({
    action: 'restoreCommit',
    restoreBatchId,
    restoreJobId,
    routes: getRoutes(),
    plates: getPlates(),
    routesMeta: getRoutesMeta(),
    platesMeta: getPlatesMeta()
  })
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
    const result = pendingCloudReplace
      ? await syncPendingCloudReplace()
      : await callSyncFunction({
        action: 'merge',
        localRecords: getStoredRecords()
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
      setLastCloudCursorAt(result.cursorAt || getMaxRecordVersion(mergedRecords) || Date.now())
      setLastSyncError('')
      setLastSyncMeta({
        status: 'success',
        action: pendingCloudReplace ? 'restore' : 'merge',
        lastSuccessAt: Date.now(),
        lastErrorAt: 0,
        lastError: '',
        syncedCount: mergedRecords.length,
        cloudCount: result.cloudCount || 0,
        localCount: result.localCount || 0,
        mergedCount: result.mergedCount || mergedRecords.length,
        failedCount: result.failedCount || 0
      })

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
    setLastSyncMeta({
      status: 'failed',
      action: pendingCloudReplace ? 'restore' : 'merge',
      lastErrorAt: Date.now(),
      lastError: result.message || '同步失败',
      failedCount: result.failedCount || 0
    })

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
    setLastSyncMeta({
      status: 'failed',
      action: hasPendingCloudReplace() ? 'restore' : 'merge',
      lastErrorAt: Date.now(),
      lastError: err.message,
      failedCount: 1
    })
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
  const lastSyncMeta = getLastSyncMeta()
  const authStatus = getAuthStatus()
  return {
    total: visibleRecords.length,
    visibleTotal: visibleRecords.length,
    pendingDeletes,
    synced: syncedCount,
    unsynced: visibleRecords.length - syncedCount,
    pendingCloudReplace: !!pendingReplace,
    pendingCloudReplaceAt: pendingReplace && pendingReplace.startedAt,
    pendingCloudReplaceUploadedCount: pendingReplace ? pendingReplace.uploadedCount || 0 : 0,
    pendingCloudReplaceRestoreBatchId: pendingReplace && pendingReplace.restoreBatchId || '',
    pendingCloudReplaceFailedCount: pendingReplace ? pendingReplace.failedCount || 0 : 0,
    pendingCloudReplaceLastError: pendingReplace && pendingReplace.lastError || '',
    lastSyncAt: lastSyncMeta.lastSuccessAt || 0,
    lastSyncText: formatMetaTime(lastSyncMeta.lastSuccessAt),
    lastErrorAt: lastSyncMeta.lastErrorAt || 0,
    lastErrorText: formatMetaTime(lastSyncMeta.lastErrorAt),
    lastSyncAction: lastSyncMeta.action || '',
    lastSyncedCount: lastSyncMeta.syncedCount || 0,
    lastCloudCount: lastSyncMeta.cloudCount || 0,
    lastLocalCount: lastSyncMeta.localCount || 0,
    lastMergedCount: lastSyncMeta.mergedCount || 0,
    lastFailedCount: lastSyncMeta.failedCount || 0,
    lastError,
    protocolError: /云函数|协议|版本/.test(lastError),
    authStatus,
    isAuthorized: authStatus !== AUTH_STATUS.UNAUTHORIZED,
    isLoggedIn: authStatus === AUTH_STATUS.AUTHORIZED
  }
}

function getSyncDetails() {
  const status = getSyncStatus()
  const profile = getUserProfile() || {}
  return {
    ...status,
    openid: getOpenid(),
    nickName: profile.nickName || '微信用户',
    avatarUrl: profile.avatarUrl || '',
    cloudProtocolVersion: CLOUD_PROTOCOL_VERSION,
    cloudFetchInterval: CLOUD_FETCH_INTERVAL,
    cloudFetchIntervalSeconds: Math.round(CLOUD_FETCH_INTERVAL / 1000),
    restoreChunkSize: RESTORE_CHUNK_SIZE,
    lastCloudCursorAt: getLastCloudCursorAt(),
    lastCloudCursorText: formatMetaTime(getLastCloudCursorAt())
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
  const backupData = backup.buildBackupData({
    schemaVersion: STORAGE_SCHEMA_VERSION,
    records,
    routes,
    plates,
    routesMeta: getRoutesMeta(),
    platesMeta: getPlatesMeta()
  })
  return JSON.stringify(backupData, null, 2)
}

function inspectBackupData(jsonStr) {
  return backup.inspectBackup(jsonStr)
}

function importAllData(jsonStr) {
  const parsed = backup.parseBackup(jsonStr)
  if (!parsed.success) {
    return parsed
  }

  try {
    const data = parsed.data
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
    setLastCloudCursorAt(0)
    return { success: true, message: '恢复成功' }
  } catch (e) {
    return { success: false, message: '解析备份文件失败' }
  }
}

module.exports = {
  initCloud,
  migrateStorageIfNeeded,
  restoreLoginState,
  hasAuthorizedLogin,
  getAuthStatus,
  setOpenid,
  getOpenid,
  isLoggedIn,
  setCloudEnabled,
  getCloudEnabled,
  getUserProfile,
  addRecord,
  getTodayRecords,
  getAllRecords,
  deleteRecord,
  updateRecord,
  getRecordById,
  syncRecords,
  refreshDictionariesFromCloud,
  getSyncStatus,
  getSyncDetails,
  cancelPendingCloudReplace,
  getRoutes,
  addRoute,
  getPlates,
  addPlate,
  deleteRoute,
  deletePlate,
  exportAllData,
  inspectBackupData,
  importAllData,
  exportRecordsToCSV: exporter.exportRecordsToCSV,
  exportRecordsToExcel: exporter.exportRecordsToExcel
}
