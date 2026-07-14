const cloud = require('wx-server-sdk')
const config = require('./config.js')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const PAGE_SIZE = config.pageSize
const MIN_CLIENT_PROTOCOL_VERSION = config.minClientProtocolVersion
const CLOUD_PROTOCOL_VERSION = config.protocolVersion
const RESTORE_LOCK_TTL = config.restoreLockTtl || 15 * 60 * 1000
const PRESENCE_ACTIVE_WINDOW = config.presenceActiveWindow || 90 * 1000
const LEGACY_GENERATION = 'legacy'

function success(payload = {}) {
  return {
    success: true,
    protocolVersion: CLOUD_PROTOCOL_VERSION,
    ...payload
  }
}

function failure(message, payload = {}) {
  return {
    success: false,
    protocolVersion: CLOUD_PROTOCOL_VERSION,
    message,
    ...payload
  }
}

function normalizeTime(value) {
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
    normalizeTime(record && record.updatedAt),
    normalizeTime(record && record.syncTime),
    normalizeTime(record && record.deletedAt),
    normalizeTime(record && record.createTime)
  )
}

function getServerRevision(record) {
  const revision = Number(record && record.serverRevision || 0)
  return Number.isFinite(revision) && revision > 0 ? revision : 0
}

function compareRecordVersions(left, right) {
  const leftRevision = getServerRevision(left)
  const rightRevision = getServerRevision(right)
  if (leftRevision || rightRevision) {
    return leftRevision - rightRevision
  }
  return getRecordVersion(left) - getRecordVersion(right)
}

function canApplyIncomingRecord(incoming, current) {
  const incomingRevision = getServerRevision(incoming)
  const currentRevision = getServerRevision(current)
  if (incomingRevision || currentRevision) {
    return incomingRevision >= currentRevision
  }
  return getRecordVersion(incoming) >= getRecordVersion(current)
}

function sortRecords(records) {
  return records.sort((a, b) => getRecordVersion(b) - getRecordVersion(a))
}

function dedupeRecordsById(records = []) {
  const recordMap = new Map()
  records.forEach((record, index) => {
    const key = record.id || record._id || `record-${index}`
    const current = recordMap.get(key)
    if (!current || compareRecordVersions(record, current) >= 0) {
      recordMap.set(key, record)
    }
  })
  return Array.from(recordMap.values())
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

function mergeDictionaryMeta(currentMeta, localMeta, shouldReplace = false) {
  if (shouldReplace) {
    return normalizeDictionaryMeta(localMeta)
  }

  const merged = normalizeDictionaryMeta(currentMeta)
  const incoming = normalizeDictionaryMeta(localMeta)

  Object.keys(incoming).forEach(name => {
    const current = merged[name]
    const next = incoming[name]
    const currentVersion = Math.max(Number(current && current.updatedAt || 0), Number(current && current.deletedAt || 0))
    const nextVersion = Math.max(Number(next.updatedAt || 0), Number(next.deletedAt || 0))
    if (!current || nextVersion >= currentVersion) {
      merged[name] = next
    }
  })

  return merged
}

function getVisibleNamesFromMeta(meta) {
  return Object.keys(meta || {})
    .map(name => meta[name])
    .filter(item => item && !item.deletedAt)
    .sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'))
    .map(item => item.name)
}

function withDeletedNames(meta, names = []) {
  const result = normalizeDictionaryMeta(meta)
  const deletedAt = Date.now()
  normalizeNameList(names).forEach(name => {
    result[name] = {
      ...(result[name] || {}),
      name,
      updatedAt: deletedAt,
      deletedAt
    }
  })
  return result
}

function buildRecordData(record, includeCreateTime = false) {
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
    'deletedAt',
    'serverRevision',
    'generation'
  ]

  fields.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      data[field] = record[field]
    }
  })

  if (includeCreateTime && record.createTime) {
    const timestamp = normalizeTime(record.createTime)
    const parsed = timestamp ? new Date(timestamp) : new Date()
    data.createTime = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  }

  if (!data.updatedAt) {
    data.updatedAt = Date.now()
  }

  data.syncTime = new Date()
  return data
}

async function fetchAllRecords(recordsCollection, openid, options = {}) {
  const {
    includeStaged = false,
    command = cloud.database().command,
    activeGeneration = LEGACY_GENERATION
  } = options
  const allRecords = []
  let lastId = ''

  while (true) {
    const where = { _openid: openid }
    if (lastId) {
      where._id = command.gt(lastId)
    }

    const res = await recordsCollection
      .where(where)
      .orderBy('_id', 'asc')
      .limit(PAGE_SIZE)
      .get()

    allRecords.push(...res.data)

    if (res.data.length < PAGE_SIZE) {
      break
    }

    lastId = res.data[res.data.length - 1]._id
    if (!lastId) {
      break
    }
  }

  if (includeStaged) {
    return allRecords
  }

  return dedupeRecordsById(allRecords.filter(record => {
    const generation = record.generation || LEGACY_GENERATION
    return generation === activeGeneration && !(generation === LEGACY_GENERATION && record.replacing)
  }))
}

async function fetchRestoreRecords(recordsCollection, openid, restoreBatchId, options = {}) {
  const { command = cloud.database().command } = options
  const allRecords = []
  let lastId = ''

  while (true) {
    const where = {
      _openid: openid,
      restoreBatchId,
      replacing: true
    }
    if (lastId) {
      where._id = command.gt(lastId)
    }

    const res = await recordsCollection
      .where(where)
      .orderBy('_id', 'asc')
      .limit(PAGE_SIZE)
      .get()

    allRecords.push(...res.data)

    if (res.data.length < PAGE_SIZE) {
      break
    }

    lastId = res.data[res.data.length - 1]._id
    if (!lastId) {
      break
    }
  }

  return allRecords
}

async function fetchChangedRecords(recordsCollection, openid, since, command, activeGeneration = LEGACY_GENERATION) {
  const sinceTime = Number(since || 0)
  if (!sinceTime || Number.isNaN(sinceTime)) {
    return fetchAllRecords(recordsCollection, openid, { command, activeGeneration })
  }

  const allRecords = []
  let lastId = ''

  while (true) {
    const where = {
      _openid: openid,
      syncTime: command.gt(new Date(sinceTime))
    }
    if (lastId) {
      where._id = command.gt(lastId)
    }

    const res = await recordsCollection
      .where(where)
      .orderBy('_id', 'asc')
      .limit(PAGE_SIZE)
      .get()

    allRecords.push(...res.data)

    if (res.data.length < PAGE_SIZE) {
      break
    }

    lastId = res.data[res.data.length - 1]._id
    if (!lastId) {
      break
    }
  }

  return dedupeRecordsById(allRecords.filter(record => {
    return (record.generation || LEGACY_GENERATION) === activeGeneration
  }))
}

async function updateRestoreJob(restoreJobs, restoreJobId, data) {
  if (!restoreJobId) return

  try {
    await restoreJobs.doc(restoreJobId).update({
      data: {
        ...data,
        syncTime: new Date()
      }
    })
  } catch (err) {
    console.error('更新恢复批次状态失败', err)
  }
}

async function saveDictionaryState(userMeta, openid, routes, plates, routesMeta, platesMeta) {
  const restoredRoutesMeta = normalizeDictionaryMeta(routesMeta, routes || [])
  const restoredPlatesMeta = normalizeDictionaryMeta(platesMeta, plates || [])
  const restoredRoutes = getVisibleNamesFromMeta(restoredRoutesMeta)
  const restoredPlates = getVisibleNamesFromMeta(restoredPlatesMeta)
  const existingMeta = await userMeta
    .where({
      _openid: openid,
      key: 'dictionary'
    })
    .get()
  const currentMeta = existingMeta.data && existingMeta.data[0]
  const metaData = {
    key: 'dictionary',
    routes: restoredRoutes,
    plates: restoredPlates,
    routesMeta: restoredRoutesMeta,
    platesMeta: restoredPlatesMeta,
    updatedAt: Date.now(),
    syncTime: new Date()
  }

  if (currentMeta) {
    await userMeta.doc(currentMeta._id).update({ data: metaData })
  } else {
    await userMeta.add({
      data: {
        _openid: openid,
        ...metaData
      }
    })
  }

  return {
    routes: restoredRoutes,
    plates: restoredPlates,
    routesMeta: restoredRoutesMeta,
    platesMeta: restoredPlatesMeta
  }
}

async function getUserMetaItem(userMeta, openid, key) {
  const res = await userMeta
    .where({
      _openid: openid,
      key
    })
    .get()
  return res.data && res.data[0]
}

async function upsertUserMetaItem(userMeta, openid, key, data) {
  const current = await getUserMetaItem(userMeta, openid, key)
  const payload = {
    key,
    ...data,
    updatedAt: Date.now(),
    syncTime: new Date()
  }

  if (current) {
    await userMeta.doc(current._id).update({ data: payload })
    return current._id
  }

  const res = await userMeta.add({
    data: {
      _openid: openid,
      ...payload
    }
  })
  return res._id
}

function hashAccountId(value) {
  let first = 2166136261
  let second = 5381
  const input = String(value || '')
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index)
    first = Math.imul(first ^ code, 16777619) >>> 0
    second = Math.imul(second, 33) ^ code
  }
  return `${first.toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

async function reserveServerRevisions(db, openid, count) {
  const size = Math.max(0, Number(count || 0))
  if (!size) {
    return function noRevision() { return 0 }
  }

  const counterId = `revision_${hashAccountId(openid)}`
  const reservation = await db.runTransaction(async transaction => {
    const counter = transaction.collection('userMeta').doc(counterId)
    let currentValue = 0
    let exists = false

    try {
      const current = await counter.get()
      if (current && current.data) {
        exists = true
        currentValue = Number(current.data.value || 0)
      }
    } catch (err) {
      exists = false
    }

    const nextValue = currentValue + size
    const data = {
      _openid: openid,
      key: 'revisionCounter',
      value: nextValue,
      updatedAt: Date.now(),
      syncTime: new Date()
    }

    if (exists) {
      await counter.update({ data })
    } else {
      await counter.set({ data })
    }

    return {
      start: currentValue + 1,
      end: nextValue
    }
  })

  let nextRevision = reservation.start
  return function takeRevision() {
    if (nextRevision > reservation.end) {
      throw new Error('服务端修订号分配不足')
    }
    return nextRevision++
  }
}

function getRecordDocumentId(openid, recordId) {
  return `record_${hashAccountId(`${openid}:${recordId}`)}`
}

async function commitRecordMutation(db, openid, incomingRecord, activeGeneration, documentId) {
  const recordId = incomingRecord && incomingRecord.id
  if (!recordId) {
    throw new Error('无效的记录数据')
  }

  const targetId = documentId || getRecordDocumentId(openid, recordId)
  const counterId = `revision_${hashAccountId(openid)}`
  return db.runTransaction(async transaction => {
    const recordRef = transaction.collection('records').doc(targetId)
    const counterRef = transaction.collection('userMeta').doc(counterId)
    let currentRecord = null
    let currentCounter = null

    try {
      const result = await recordRef.get()
      currentRecord = result && result.data
    } catch (err) {
      currentRecord = null
    }

    const currentGeneration = currentRecord && (currentRecord.generation || LEGACY_GENERATION)
    const isCurrentGeneration = currentRecord && currentGeneration === activeGeneration
    if (isCurrentGeneration && currentRecord.id && currentRecord.id !== recordId) {
      throw new Error('记录主键冲突，请重试同步')
    }
    if (isCurrentGeneration && !canApplyIncomingRecord(incomingRecord, currentRecord)) {
      return {
        skipped: true,
        record: {
          ...currentRecord,
          id: currentRecord.id || recordId,
          synced: true
        }
      }
    }

    try {
      const result = await counterRef.get()
      currentCounter = result && result.data
    } catch (err) {
      currentCounter = null
    }

    const serverRevision = Math.max(0, Number(currentCounter && currentCounter.value || 0)) + 1
    const counterData = {
      _openid: openid,
      key: 'revisionCounter',
      value: serverRevision,
      updatedAt: Date.now(),
      syncTime: new Date()
    }
    if (currentCounter) {
      await counterRef.update({ data: counterData })
    } else {
      await counterRef.set({ data: counterData })
    }

    const nextRecord = {
      ...(isCurrentGeneration ? currentRecord : {}),
      ...incomingRecord,
      id: recordId,
      generation: activeGeneration,
      serverRevision
    }
    const recordData = buildRecordData(nextRecord, !isCurrentGeneration)
    if (isCurrentGeneration) {
      await recordRef.update({ data: recordData })
    } else {
      await recordRef.set({
        data: {
          _openid: openid,
          ...recordData
        }
      })
    }

    return {
      skipped: false,
      record: {
        ...nextRecord,
        _id: targetId,
        synced: true
      }
    }
  })
}

async function commitPendingMutation(db, openid, incomingRecord, activeGeneration, documentId) {
  let mutation = await commitRecordMutation(db, openid, incomingRecord, activeGeneration, documentId)
  if (mutation.skipped && mutation.record) {
    mutation = await commitRecordMutation(db, openid, {
      ...incomingRecord,
      serverRevision: getServerRevision(mutation.record)
    }, activeGeneration, mutation.record._id || documentId)
  }
  return mutation
}

async function ensureActiveGeneration(userMeta, openid) {
  const generationId = `active_generation_${hashAccountId(openid)}`
  let current = null
  try {
    const result = await userMeta.doc(generationId).get()
    current = result && result.data
  } catch (err) {
    current = await getUserMetaItem(userMeta, openid, 'activeGeneration')
  }
  if (current && current.activeGeneration) {
    if (current._id !== generationId) {
      const { _id: ignoredId, ...currentData } = current
      await userMeta.doc(generationId).set({ data: {
        _openid: openid,
        ...currentData,
        key: 'activeGeneration'
      } })
    }
    return current.activeGeneration
  }

  await userMeta.doc(generationId).set({ data: {
    _openid: openid,
    key: 'activeGeneration',
    activeGeneration: LEGACY_GENERATION,
    activatedAt: Date.now(),
    updatedAt: Date.now(),
    syncTime: new Date()
  } })
  return LEGACY_GENERATION
}

async function commitActiveGeneration(db, openid, generation, previousGeneration) {
  const generationId = `active_generation_${hashAccountId(openid)}`
  const lockId = `restore_lock_${hashAccountId(openid)}`
  return db.runTransaction(async transaction => {
    const generationRef = transaction.collection('userMeta').doc(generationId)
    const lockRef = transaction.collection('userMeta').doc(lockId)
    let lock = null
    try {
      const result = await lockRef.get()
      lock = result && result.data
    } catch (err) {
      lock = null
    }
    if (!lock || lock.status !== 'active' || lock.restoreBatchId !== generation) {
      throw new Error('恢复任务锁已失效，未切换云端数据')
    }

    const now = Date.now()
    await generationRef.set({ data: {
      _openid: openid,
      key: 'activeGeneration',
      activeGeneration: generation,
      previousGeneration: previousGeneration || '',
      activatedAt: now,
      updatedAt: now,
      syncTime: new Date()
    } })
    await lockRef.set({ data: {
      _openid: openid,
      key: 'restoreLock',
      ...lock,
      status: 'completed',
      releasedAt: now,
      updatedAt: now,
      syncTime: new Date()
    } })
  })
}

async function fetchHistoryPage(recordsCollection, openid, activeGeneration, cursor, limit, command) {
  const pageLimit = Math.min(Math.max(Number(limit || 20), 1), 100)
  const collected = []
  let currentDate = cursor && typeof cursor === 'object' ? String(cursor.date || '') : ''
  let currentId = cursor && typeof cursor === 'object' ? String(cursor.id || '') : ''

  const withGeneration = where => {
    if (activeGeneration !== LEGACY_GENERATION) {
      where.generation = activeGeneration
    }
    return where
  }

  const findNextDate = async beforeDate => {
    let boundary = beforeDate
    while (true) {
      const where = withGeneration({ _openid: openid })
      if (boundary) {
        where.date = command.lt(boundary)
      }
      const res = await recordsCollection
        .where(where)
        .orderBy('date', 'desc')
        .limit(PAGE_SIZE)
        .get()
      const batch = res.data || []
      const candidate = batch.find(item => {
        const generation = item.generation || LEGACY_GENERATION
        return generation === activeGeneration && typeof item.date === 'string' && item.date
      })
      if (candidate) return candidate.date
      if (batch.length < PAGE_SIZE) return ''
      const lastDate = batch[batch.length - 1] && batch[batch.length - 1].date
      if (!lastDate || lastDate === boundary) return ''
      boundary = lastDate
    }
  }

  if (!currentDate) {
    currentDate = await findNextDate('')
  }

  while (collected.length <= pageLimit && currentDate) {
    const where = withGeneration({
      _openid: openid,
      date: currentDate
    })
    if (currentId) where._id = command.lt(currentId)
    const res = await recordsCollection
      .where(where)
      .orderBy('_id', 'desc')
      .limit(PAGE_SIZE)
      .get()
    const batch = res.data || []

    for (const item of batch) {
      currentId = item._id || currentId
      const generation = item.generation || LEGACY_GENERATION
      if (generation !== activeGeneration || item.deletedAt) continue
      collected.push(item)
      if (collected.length > pageLimit) break
    }

    if (collected.length > pageLimit) break
    if (batch.length < PAGE_SIZE) {
      currentDate = await findNextDate(currentDate)
      currentId = ''
    }
  }

  const hasMore = collected.length > pageLimit || !!currentDate
  const pageRecords = collected.slice(0, pageLimit)
  const lastRecord = pageRecords[pageRecords.length - 1]
  return {
    records: pageRecords,
    hasMore,
    nextCursor: hasMore && lastRecord
      ? { date: lastRecord.date || '', id: lastRecord._id || '' }
      : null
  }
}

async function getActiveRestoreLock(userMeta, openid) {
  const lockId = `restore_lock_${hashAccountId(openid)}`
  let lock = null
  try {
    const result = await userMeta.doc(lockId).get()
    lock = result && result.data
  } catch (err) {
    lock = await getUserMetaItem(userMeta, openid, 'restoreLock')
  }
  if (!lock || !lock.restoreBatchId || lock.status !== 'active') {
    return null
  }

  const lockedAt = Number(lock.lockedAt || 0)
  if (lockedAt && Date.now() - lockedAt < RESTORE_LOCK_TTL) {
    return lock
  }

  await userMeta.doc(lockId).set({ data: {
    _openid: openid,
    key: 'restoreLock',
    ...lock,
    status: 'expired',
    expiredAt: Date.now(),
    updatedAt: Date.now(),
    syncTime: new Date()
  } })
  return null
}

async function acquireRestoreLock(db, openid, restoreBatchId, expectedCount) {
  const lockId = `restore_lock_${hashAccountId(openid)}`
  return db.runTransaction(async transaction => {
    const lockRef = transaction.collection('userMeta').doc(lockId)
    let lock = null
    try {
      const result = await lockRef.get()
      lock = result && result.data
    } catch (err) {
      lock = null
    }

    const lockedAt = Number(lock && lock.lockedAt || 0)
    const isActive = lock && lock.status === 'active' && lockedAt && Date.now() - lockedAt < RESTORE_LOCK_TTL
    if (isActive) {
      return { success: false, lock }
    }

    await lockRef.set({ data: {
      _openid: openid,
      key: 'restoreLock',
      status: 'active',
      restoreBatchId,
      expectedCount: Math.max(0, Number(expectedCount || 0)),
      lockedAt: Date.now(),
      updatedAt: Date.now(),
      syncTime: new Date()
    } })
    return { success: true }
  })
}

async function touchRestoreLock(db, openid, restoreBatchId) {
  const lockId = `restore_lock_${hashAccountId(openid)}`
  return db.runTransaction(async transaction => {
    const lockRef = transaction.collection('userMeta').doc(lockId)
    let lock = null
    try {
      const result = await lockRef.get()
      lock = result && result.data
    } catch (err) {
      lock = null
    }
    if (!lock || lock.status !== 'active' || lock.restoreBatchId !== restoreBatchId) {
      return { success: false, lock }
    }

    const now = Date.now()
    await lockRef.set({ data: {
      _openid: openid,
      key: 'restoreLock',
      ...lock,
      lockedAt: now,
      updatedAt: now,
      syncTime: new Date()
    } })
    return { success: true, lock: { ...lock, lockedAt: now } }
  })
}

async function releaseRestoreLock(userMeta, openid, restoreBatchId, status = 'released') {
  const lockId = `restore_lock_${hashAccountId(openid)}`
  let lock = null
  try {
    const result = await userMeta.doc(lockId).get()
    lock = result && result.data
  } catch (err) {
    lock = null
  }
  if (!lock || lock.restoreBatchId !== restoreBatchId) {
    return
  }

  await userMeta.doc(lockId).set({ data: {
    _openid: openid,
    key: 'restoreLock',
    ...lock,
    status,
    releasedAt: Date.now(),
    updatedAt: Date.now(),
    syncTime: new Date()
  } })
}

async function countActivePresence(userMeta, command) {
  const cutoff = Date.now() - PRESENCE_ACTIVE_WINDOW
  const res = await userMeta
    .where({
      key: 'presence',
      lastSeenAt: command.gt(cutoff)
    })
    .count()

  return res.total || 0
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const db = cloud.database()
  const _ = db.command
  const records = db.collection('records')
  const userMeta = db.collection('userMeta')
  const restoreJobs = db.collection('restoreJobs')

  const { action, localRecords, record, id, protocolVersion, routes, plates, routesMeta, platesMeta, deletedRoutes, deletedPlates, mode, since } = event

  try {
    if (action === 'protocol') {
      return success({
        minClientProtocolVersion: MIN_CLIENT_PROTOCOL_VERSION
      })
    }

    if (!protocolVersion || protocolVersion < MIN_CLIENT_PROTOCOL_VERSION || protocolVersion > CLOUD_PROTOCOL_VERSION) {
      return failure('客户端与云函数同步协议不一致，请部署最新版本', {
        code: 'PROTOCOL_MISMATCH',
        expectedProtocolVersion: CLOUD_PROTOCOL_VERSION,
        minClientProtocolVersion: MIN_CLIENT_PROTOCOL_VERSION,
        receivedProtocolVersion: protocolVersion || 0
      })
    }

    const activeGeneration = await ensureActiveGeneration(userMeta, wxContext.OPENID)

    if (action === 'presence') {
      const now = Date.now()
      const presenceId = `presence_${hashAccountId(wxContext.OPENID)}`
      await userMeta.doc(presenceId).set({ data: {
        _openid: wxContext.OPENID,
        key: 'presence',
        lastSeenAt: now,
        updatedAt: now,
        syncTime: new Date()
      } })
      const duplicatePresence = await userMeta.where({
        _openid: wxContext.OPENID,
        key: 'presence'
      }).get()
      for (const item of duplicatePresence.data || []) {
        if (item._id !== presenceId) {
          await userMeta.doc(item._id).remove()
        }
      }

      const onlineCount = await countActivePresence(userMeta, _)
      return success({
        onlineCount,
        activeWindowSeconds: Math.round(PRESENCE_ACTIVE_WINDOW / 1000),
        lastSeenAt: now
      })
    }

    if (action === 'syncMeta') {
      const localRoutes = Array.isArray(routes) ? routes.map(item => String(item || '').trim()).filter(Boolean) : []
      const localPlates = Array.isArray(plates) ? plates.map(item => String(item || '').trim()).filter(Boolean) : []
      const existing = await userMeta
        .where({
          _openid: wxContext.OPENID,
          key: 'dictionary'
        })
        .get()

      const current = existing.data && existing.data[0]
      const shouldReplace = mode === 'replace'
      const localRouteMeta = withDeletedNames(normalizeDictionaryMeta(routesMeta, localRoutes), deletedRoutes)
      const localPlateMeta = withDeletedNames(normalizeDictionaryMeta(platesMeta, localPlates), deletedPlates)
      const currentRouteMeta = normalizeDictionaryMeta(current && current.routesMeta, current && current.routes || [])
      const currentPlateMeta = normalizeDictionaryMeta(current && current.platesMeta, current && current.plates || [])
      const mergedRoutesMeta = mergeDictionaryMeta(currentRouteMeta, localRouteMeta, shouldReplace)
      const mergedPlatesMeta = mergeDictionaryMeta(currentPlateMeta, localPlateMeta, shouldReplace)
      const mergedRoutes = getVisibleNamesFromMeta(mergedRoutesMeta)
      const mergedPlates = getVisibleNamesFromMeta(mergedPlatesMeta)
      const data = {
        key: 'dictionary',
        routes: mergedRoutes,
        plates: mergedPlates,
        routesMeta: mergedRoutesMeta,
        platesMeta: mergedPlatesMeta,
        updatedAt: Date.now(),
        syncTime: new Date()
      }

      if (current) {
        await userMeta.doc(current._id).update({ data })
      } else {
        await userMeta.add({
          data: {
            _openid: wxContext.OPENID,
            ...data
          }
        })
      }

      return success({
        routes: mergedRoutes,
        plates: mergedPlates,
        routesMeta: mergedRoutesMeta,
        platesMeta: mergedPlatesMeta
      })
    }

    if (action === 'upsert') {
      if (!record || !record.id) {
        return failure('无效的记录数据')
      }

      const existing = await records
        .where({
          _openid: wxContext.OPENID,
          id: record.id
        })
        .get()
      const activeExisting = (existing.data || []).filter(item => {
        return (item.generation || LEGACY_GENERATION) === activeGeneration
      })
      const target = activeExisting.length > 0
        ? activeExisting.sort((left, right) => compareRecordVersions(right, left))[0]
        : null
      const mutation = await commitRecordMutation(
        db,
        wxContext.OPENID,
        record,
        activeGeneration,
        target && target._id
      )
      return success({
        ...mutation,
        reason: mutation.skipped ? '云端记录更新，已保留云端版本' : ''
      })
    }

    if (action === 'delete') {
      if (!id) {
        return failure('无效的记录ID')
      }

      const existing = await records
        .where({
          _openid: wxContext.OPENID,
          id
        })
        .get()
      const activeExisting = (existing.data || []).filter(item => {
        return (item.generation || LEGACY_GENERATION) === activeGeneration
      })

      let deleted = 0
      let skipped = 0
      let latestRecord = null

      for (const item of activeExisting) {
        const mutation = await commitRecordMutation(db, wxContext.OPENID, {
          ...item,
          ...(record || {}),
          id,
          deletedAt: (record && record.deletedAt) || Date.now()
        }, activeGeneration, item._id)
        if (mutation.skipped) {
          skipped++
          if (!latestRecord || compareRecordVersions(mutation.record, latestRecord) > 0) {
            latestRecord = mutation.record
          }
          continue
        }
        deleted++
      }

      return success({
        deleted,
        skipped,
        record: latestRecord ? {
          ...latestRecord,
          id: latestRecord.id || id,
          synced: true
        } : null
      })
    }

    if (action === 'syncPending') {
      if (!Array.isArray(localRecords)) {
        return failure('无效的待同步数据')
      }

      const syncedRecords = []
      const failedSyncIds = []
      for (const localRecord of localRecords) {
        const recordId = localRecord && localRecord.id
        if (!recordId || localRecord.synced !== false) continue

        try {
          const existing = await records.where({
            _openid: wxContext.OPENID,
            id: recordId
          }).get()
          const activeExisting = (existing.data || []).filter(item => {
            return (item.generation || LEGACY_GENERATION) === activeGeneration
          }).sort((left, right) => compareRecordVersions(right, left))

          if (localRecord.deletedAt && activeExisting.length === 0) {
            syncedRecords.push({
              ...localRecord,
              generation: activeGeneration,
              synced: true
            })
            continue
          }

          const targets = localRecord.deletedAt ? activeExisting : [activeExisting[0] || null]
          let latestMutation = null
          for (const target of targets) {
            const mutation = await commitPendingMutation(
              db,
              wxContext.OPENID,
              localRecord,
              activeGeneration,
              target && target._id
            )
            if (!latestMutation || compareRecordVersions(mutation.record, latestMutation.record) > 0) {
              latestMutation = mutation
            }
          }
          if (latestMutation && latestMutation.record) {
            syncedRecords.push(latestMutation.record)
          }
        } catch (err) {
          console.error('待同步记录上传失败', recordId, err)
          failedSyncIds.push(recordId)
        }
      }

      return success({
        records: syncedRecords,
        syncedCount: syncedRecords.length,
        failedCount: failedSyncIds.length,
        failedSyncIds,
        activeGeneration
      })
    }

    if (action === 'download') {
      const queryStartedAt = Date.now()
      const data = sortRecords(await fetchAllRecords(records, wxContext.OPENID, {
        activeGeneration,
        command: _
      }))

      return success({
        records: data,
        count: data.length,
        cursorAt: queryStartedAt,
        activeGeneration
      })
    }

    if (action === 'downloadChanges') {
      const queryStartedAt = Date.now()
      const data = sortRecords(await fetchChangedRecords(records, wxContext.OPENID, since, _, activeGeneration))

      return success({
        records: data,
        count: data.length,
        since: Number(since || 0),
        cursorAt: queryStartedAt,
        activeGeneration
      })
    }

    if (action === 'historyPage') {
      const page = await fetchHistoryPage(
        records,
        wxContext.OPENID,
        activeGeneration,
        event.cursor,
        event.pageSize,
        _
      )
      return success({
        ...page,
        activeGeneration
      })
    }

    if (action === 'restoreStatus') {
      const restoreBatchId = String(event.restoreBatchId || '')
      if (!restoreBatchId) {
        return failure('无效的恢复批次')
      }

      if (activeGeneration === restoreBatchId) {
        return success({
          status: 'committed',
          restoreBatchId,
          activeGeneration
        })
      }

      const activeLock = await getActiveRestoreLock(userMeta, wxContext.OPENID)
      const stagedRecords = await fetchRestoreRecords(records, wxContext.OPENID, restoreBatchId)
      const isActive = activeLock && activeLock.restoreBatchId === restoreBatchId
      return success({
        status: isActive ? 'active' : 'expired',
        restoreBatchId,
        expectedCount: isActive ? Number(activeLock.expectedCount || 0) : 0,
        stagedCount: stagedRecords.length,
        lockedAt: isActive ? Number(activeLock.lockedAt || 0) : 0,
        activeGeneration
      })
    }

    if (action === 'restoreStart') {
      const restoreBatchId = `restore_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      let restoreJobId = ''
      const lockResult = await acquireRestoreLock(db, wxContext.OPENID, restoreBatchId, event.localCount)
      if (!lockResult.success) {
        return failure('已有恢复任务正在上传，请稍后再试或先取消恢复', {
          code: 'RESTORE_LOCKED',
          restoreBatchId: lockResult.lock && lockResult.lock.restoreBatchId,
          lockedAt: lockResult.lock && lockResult.lock.lockedAt
        })
      }

      try {
        const allCloudRecords = await fetchAllRecords(records, wxContext.OPENID, {
          includeStaged: true,
          command: _
        })
        const visibleCloudRecords = allCloudRecords.filter(item => {
          return (item.generation || LEGACY_GENERATION) === activeGeneration
        })
        const staleStagedRecords = allCloudRecords.filter(item => {
          const generation = item.generation || LEGACY_GENERATION
          return item.replacing && generation !== activeGeneration
        })

        for (const item of staleStagedRecords) {
          await records.doc(item._id).remove()
        }

        try {
          const jobRes = await restoreJobs.add({
            data: {
              _openid: wxContext.OPENID,
              restoreBatchId,
              previousGeneration: activeGeneration,
              status: 'staging',
              localCount: Number(event.localCount || 0),
              cloudCount: visibleCloudRecords.length,
              uploadedCount: 0,
              failedCount: 0,
              createdAt: Date.now(),
              syncTime: new Date()
            }
          })
          restoreJobId = jobRes._id
        } catch (err) {
          console.error('记录恢复批次状态失败', err)
        }

        return success({
          restoreBatchId,
          restoreJobId,
          previousGeneration: activeGeneration,
          cloudCount: visibleCloudRecords.length
        })
      } catch (err) {
        await releaseRestoreLock(userMeta, wxContext.OPENID, restoreBatchId, 'failed')
        throw err
      }
    }

    if (action === 'restoreChunk') {
      const { restoreBatchId, restoreJobId, offset = 0 } = event
      if (!restoreBatchId || !Array.isArray(localRecords)) {
        return failure('无效的恢复分片数据')
      }
      const activeLock = await getActiveRestoreLock(userMeta, wxContext.OPENID)
      if (!activeLock || activeLock.restoreBatchId !== restoreBatchId) {
        return failure('恢复任务已过期或被其他设备占用，请重新开始恢复', {
          code: 'RESTORE_LOCK_INVALID'
        })
      }
      const touchedLock = await touchRestoreLock(db, wxContext.OPENID, restoreBatchId)
      if (!touchedLock.success) {
        return failure('恢复任务锁已失效，请重新开始恢复', {
          code: 'RESTORE_LOCK_INVALID'
        })
      }

      const uploadedRecords = []
      let failed = 0
      const validRecords = localRecords.filter(localRecord => localRecord.id && !localRecord.deletedAt)
      const takeRevision = await reserveServerRevisions(db, wxContext.OPENID, validRecords.length)
      const stagedRecords = await fetchRestoreRecords(records, wxContext.OPENID, restoreBatchId)
      const stagedByRecordId = new Map()
      stagedRecords.forEach(record => {
        if (!record.id) return
        const existing = stagedByRecordId.get(record.id) || []
        existing.push(record)
        stagedByRecordId.set(record.id, existing)
      })

      for (const localRecord of localRecords) {
        if (!localRecord.id || localRecord.deletedAt) {
          continue
        }

        try {
          const serverRevision = takeRevision()
          const existingStaged = stagedByRecordId.get(localRecord.id) || []
          const restoreRecordId = existingStaged[0] && existingStaged[0]._id
            ? existingStaged[0]._id
            : `restore_record_${hashAccountId(`${wxContext.OPENID}:${restoreBatchId}:${localRecord.id}`)}`
          await records.doc(restoreRecordId).set({
            data: {
              _openid: wxContext.OPENID,
              ...buildRecordData({
                ...localRecord,
                generation: restoreBatchId,
                serverRevision
              }, true),
              restoreBatchId,
              replacing: true
            }
          })
          for (const duplicate of existingStaged.slice(1)) {
            await records.doc(duplicate._id).remove()
          }
          uploadedRecords.push({
            ...localRecord,
            _id: restoreRecordId,
            generation: restoreBatchId,
            serverRevision,
            synced: true
          })
        } catch (err) {
          console.error('恢复分片上传单条记录失败', localRecord.id, err)
          failed++
          uploadedRecords.push({
            ...localRecord,
            synced: false
          })
        }
      }

      await updateRestoreJob(restoreJobs, restoreJobId, {
        status: failed > 0 ? 'staging_with_errors' : 'staging',
        lastOffset: offset,
        uploadedCount: Number(offset || 0) + uploadedRecords.filter(item => item.synced).length,
        failedCount: failed
      })

      return success({
        restoreBatchId,
        restoreJobId,
        uploadedRecords,
        uploadedCount: uploadedRecords.filter(item => item.synced).length,
        failedCount: failed
      })
    }

    if (action === 'restoreAbort') {
      const { restoreBatchId, restoreJobId, reason = '恢复已取消' } = event
      if (!restoreBatchId) {
        return failure('无效的恢复批次')
      }
      if (activeGeneration === restoreBatchId) {
        return failure('恢复批次已生效，不能再取消', {
          code: 'RESTORE_ALREADY_COMMITTED'
        })
      }
      const activeLock = await getActiveRestoreLock(userMeta, wxContext.OPENID)
      if (activeLock && activeLock.restoreBatchId !== restoreBatchId) {
        return failure('恢复任务已被其他设备占用，无法取消当前批次', {
          code: 'RESTORE_LOCK_INVALID'
        })
      }

      const stagedRecords = await fetchRestoreRecords(records, wxContext.OPENID, restoreBatchId)
      for (const item of stagedRecords) {
        await records.doc(item._id).remove()
      }
      await releaseRestoreLock(userMeta, wxContext.OPENID, restoreBatchId, 'aborted')
      await updateRestoreJob(restoreJobs, restoreJobId, {
        status: 'aborted',
        reason,
        abortedAt: Date.now()
      })

      return success({
        restoreBatchId,
        removedCount: stagedRecords.length
      })
    }

    if (action === 'restoreCommit') {
      const actionStartedAt = Date.now()
      const { restoreBatchId, restoreJobId } = event
      if (!restoreBatchId) {
        return failure('无效的恢复批次')
      }
      const activeLock = await getActiveRestoreLock(userMeta, wxContext.OPENID)
      if (!activeLock || activeLock.restoreBatchId !== restoreBatchId) {
        return failure('恢复任务已过期或被其他设备占用，请重新开始恢复', {
          code: 'RESTORE_LOCK_INVALID'
        })
      }

      const stagedRecords = await fetchRestoreRecords(records, wxContext.OPENID, restoreBatchId)
      const expectedCount = Math.max(0, Number(activeLock.expectedCount || 0))
      if (stagedRecords.length !== expectedCount) {
        return failure('恢复记录数量校验失败，未切换云端数据', {
          code: 'RESTORE_COUNT_MISMATCH',
          expectedCount,
          uploadedCount: stagedRecords.length
        })
      }
      const previousGeneration = activeGeneration
      const visibleCloudRecords = await fetchAllRecords(records, wxContext.OPENID, {
        activeGeneration: previousGeneration,
        command: _
      })
      const fallbackRoutesMeta = normalizeDictionaryMeta(routesMeta, routes || [])
      const fallbackPlatesMeta = normalizeDictionaryMeta(platesMeta, plates || [])
      let restoredMeta = {
        routes: getVisibleNamesFromMeta(fallbackRoutesMeta),
        plates: getVisibleNamesFromMeta(fallbackPlatesMeta),
        routesMeta: fallbackRoutesMeta,
        platesMeta: fallbackPlatesMeta
      }
      let dictionarySyncPending = false

      await commitActiveGeneration(db, wxContext.OPENID, restoreBatchId, previousGeneration)

      try {
        restoredMeta = await saveDictionaryState(userMeta, wxContext.OPENID, routes, plates, routesMeta, platesMeta)
      } catch (err) {
        dictionarySyncPending = true
        console.error('恢复记录已生效，字典状态等待重试', err)
      }

      for (const item of stagedRecords) {
        try {
          await records.doc(item._id).update({ data: { replacing: false } })
        } catch (err) {
          console.error('清理恢复记录暂存标记失败', item._id, err)
        }
      }

      const merged = sortRecords(stagedRecords.map(item => {
        const { replacing, restoreBatchId: ignoredRestoreBatchId, ...recordData } = item
        return {
          ...recordData,
          synced: true
        }
      }))

      await updateRestoreJob(restoreJobs, restoreJobId, {
        status: 'completed',
        mergedCount: merged.length,
        completedAt: Date.now()
      })

      return success({
        mergedRecords: merged,
        cloudCount: visibleCloudRecords.length,
        localCount: merged.length,
        mergedCount: merged.length,
        failedCount: 0,
        cleanupPendingCount: visibleCloudRecords.length,
        previousGeneration,
        activeGeneration: restoreBatchId,
        restoreBatchId,
        restoreJobId,
        cursorAt: actionStartedAt,
        dictionarySyncPending,
        ...restoredMeta
      })
    }

    if (action === 'cleanupGeneration') {
      const generation = String(event.generation || '')
      if (!generation || generation === activeGeneration) {
        return failure('不能清理当前生效的数据批次')
      }

      const allRecords = await fetchAllRecords(records, wxContext.OPENID, {
        includeStaged: true,
        command: _
      })
      const staleRecords = allRecords.filter(item => {
        return (item.generation || LEGACY_GENERATION) === generation
      })
      let removedCount = 0
      let failedCount = 0
      for (const item of staleRecords) {
        try {
          await records.doc(item._id).remove()
          removedCount++
        } catch (err) {
          failedCount++
        }
      }
      return success({ removedCount, failedCount, generation })
    }

    if (action === 'replace' || action === 'restoreAll') {
      return failure('旧版恢复接口已停用，请使用新版分片恢复流程', {
        code: 'LEGACY_RESTORE_DISABLED'
      })
    }

    if (action === 'merge') {
      const actionStartedAt = Date.now()
      if (!localRecords || !Array.isArray(localRecords)) {
        return failure('无效的本地数据')
      }

      const cloudRecords = await fetchAllRecords(records, wxContext.OPENID, {
        activeGeneration,
        command: _
      })
      const cloudMap = new Map()
      const mergedMap = new Map()
      const failedSyncIds = []

      cloudRecords.forEach(record => {
        const key = record.id || record._id
        const current = cloudMap.get(key)
        if (!current || compareRecordVersions(record, current) >= 0) {
          cloudMap.set(key, record)
          mergedMap.set(key, {
            ...record,
            id: record.id || record._id,
            synced: true
          })
        }
      })

      for (const localRecord of localRecords) {
        const recordId = localRecord.id
        if (!recordId) {
          continue
        }

        const cloudRecord = cloudMap.get(recordId)

        try {
          if (localRecord.deletedAt) {
            if (cloudRecord) {
              if (localRecord.synced === false) {
                const mutation = await commitRecordMutation(
                  db,
                  wxContext.OPENID,
                  localRecord,
                  activeGeneration,
                  cloudRecord._id
                )
                mergedMap.set(recordId, {
                  ...mutation.record,
                  id: recordId
                })
                continue
              }
            } else {
              mergedMap.delete(recordId)
              continue
            }
          }

          if (!cloudRecord) {
            if (localRecord.synced !== false) {
              mergedMap.delete(recordId)
              continue
            }
            const mutation = await commitRecordMutation(
              db,
              wxContext.OPENID,
              localRecord,
              activeGeneration
            )
            mergedMap.set(recordId, {
              ...mutation.record,
              id: recordId
            })
            continue
          }

          if (localRecord.synced === false) {
            const mutation = await commitRecordMutation(
              db,
              wxContext.OPENID,
              localRecord,
              activeGeneration,
              cloudRecord._id
            )
            mergedMap.set(recordId, {
              ...mutation.record,
              id: recordId
            })
            continue
          }

          mergedMap.set(recordId, {
            ...cloudRecord,
            _id: cloudRecord._id,
            id: recordId,
            synced: true
          })
        } catch (err) {
          console.error('合并单条记录失败', recordId, err)
          failedSyncIds.push(recordId)
          mergedMap.set(recordId, {
            ...cloudRecord,
            ...localRecord,
            _id: cloudRecord && cloudRecord._id,
            id: recordId,
            synced: false
          })
        }
      }

      const merged = sortRecords(Array.from(mergedMap.values()))

      return success({
        mergedRecords: merged,
        cloudCount: cloudRecords.length,
        localCount: localRecords.length,
        mergedCount: merged.length,
        failedCount: failedSyncIds.length,
        failedSyncIds,
        cursorAt: actionStartedAt,
        activeGeneration
      })
    }

    return failure('未知操作')
  } catch (err) {
    return failure(err.message, { error: err.message })
  }
}
