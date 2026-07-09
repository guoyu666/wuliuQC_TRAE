const cloud = require('wx-server-sdk')
const config = require('./config.js')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const PAGE_SIZE = config.pageSize
const MIN_CLIENT_PROTOCOL_VERSION = config.minClientProtocolVersion
const CLOUD_PROTOCOL_VERSION = config.protocolVersion
const RESTORE_LOCK_TTL = config.restoreLockTtl || 15 * 60 * 1000

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

function sortRecords(records) {
  return records.sort((a, b) => getRecordVersion(b) - getRecordVersion(a))
}

function dedupeRecordsById(records = []) {
  const recordMap = new Map()
  records.forEach((record, index) => {
    const key = record.id || record._id || `record-${index}`
    const current = recordMap.get(key)
    if (!current || getRecordVersion(record) >= getRecordVersion(current)) {
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
    'deletedAt'
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
  const { includeStaged = false, command = cloud.database().command } = options
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

  return dedupeRecordsById(allRecords.filter(record => !record.replacing))
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

async function fetchChangedRecords(recordsCollection, openid, since, command) {
  const sinceTime = Number(since || 0)
  if (!sinceTime || Number.isNaN(sinceTime)) {
    return fetchAllRecords(recordsCollection, openid, { command })
  }

  const allRecords = []
  let lastId = ''

  while (true) {
    const where = {
      _openid: openid,
      replacing: command.neq(true),
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

  return dedupeRecordsById(allRecords)
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

async function getActiveRestoreLock(userMeta, openid) {
  const lock = await getUserMetaItem(userMeta, openid, 'restoreLock')
  if (!lock || !lock.restoreBatchId || lock.status !== 'active') {
    return null
  }

  const lockedAt = Number(lock.lockedAt || 0)
  if (lockedAt && Date.now() - lockedAt < RESTORE_LOCK_TTL) {
    return lock
  }

  await upsertUserMetaItem(userMeta, openid, 'restoreLock', {
    ...lock,
    status: 'expired',
    expiredAt: Date.now()
  })
  return null
}

async function acquireRestoreLock(userMeta, openid, restoreBatchId) {
  const activeLock = await getActiveRestoreLock(userMeta, openid)
  if (activeLock) {
    return {
      success: false,
      lock: activeLock
    }
  }

  await upsertUserMetaItem(userMeta, openid, 'restoreLock', {
    status: 'active',
    restoreBatchId,
    lockedAt: Date.now()
  })
  return { success: true }
}

async function releaseRestoreLock(userMeta, openid, restoreBatchId, status = 'released') {
  const lock = await getUserMetaItem(userMeta, openid, 'restoreLock')
  if (!lock || lock.restoreBatchId !== restoreBatchId) {
    return
  }

  await upsertUserMetaItem(userMeta, openid, 'restoreLock', {
    ...lock,
    status,
    releasedAt: Date.now()
  })
}

async function revealStagedRecords(recordsCollection, stagedRecords) {
  const revealedIds = []

  try {
    for (const item of stagedRecords) {
      await recordsCollection.doc(item._id).update({
        data: {
          replacing: false
        }
      })
      revealedIds.push(item._id)
    }
  } catch (err) {
    for (const revealedId of revealedIds) {
      try {
        await recordsCollection.doc(revealedId).update({
          data: {
            replacing: true
          }
        })
      } catch (rollbackErr) {
        console.error('回滚恢复批次记录失败', revealedId, rollbackErr)
      }
    }
    throw err
  }
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

      if (existing.data && existing.data.length > 0) {
        const target = existing.data[0]
        const incomingVersion = getRecordVersion(record)
        const cloudVersion = getRecordVersion(target)

        if (incomingVersion < cloudVersion) {
          return success({
            record: {
              ...target,
              id: target.id || record.id,
              synced: true
            },
            skipped: true,
            reason: '云端记录更新，已保留云端版本'
          })
        }

        await records.doc(target._id).update({
          data: buildRecordData(record)
        })
        return success({
          record: {
            ...target,
            ...record,
            _id: target._id,
            synced: true
          }
        })
      }

      const createRes = await records.add({
        data: {
          _openid: wxContext.OPENID,
          ...buildRecordData(record, true)
        }
      })

      return success({
        record: {
          ...record,
          _id: createRes._id,
          synced: true
        }
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

      let deleted = 0
      let skipped = 0
      let latestRecord = null
      const incomingVersion = getRecordVersion(record || {})

      for (const item of existing.data || []) {
        const cloudVersion = getRecordVersion(item)
        if (incomingVersion && incomingVersion < cloudVersion) {
          skipped++
          if (!latestRecord || cloudVersion > getRecordVersion(latestRecord)) {
            latestRecord = item
          }
          continue
        }

        await records.doc(item._id).update({
          data: buildRecordData({
            ...item,
            ...(record || {}),
            id,
            deletedAt: (record && record.deletedAt) || Date.now()
          })
        })
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

    if (action === 'download') {
      const queryStartedAt = Date.now()
      const data = sortRecords(await fetchAllRecords(records, wxContext.OPENID))

      return success({
        records: data,
        count: data.length,
        cursorAt: queryStartedAt
      })
    }

    if (action === 'downloadChanges') {
      const queryStartedAt = Date.now()
      const data = sortRecords(await fetchChangedRecords(records, wxContext.OPENID, since, _))

      return success({
        records: data,
        count: data.length,
        since: Number(since || 0),
        cursorAt: queryStartedAt
      })
    }

    if (action === 'restoreStart') {
      const restoreBatchId = `restore_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      let restoreJobId = ''
      const lockResult = await acquireRestoreLock(userMeta, wxContext.OPENID, restoreBatchId)
      if (!lockResult.success) {
        return failure('已有恢复任务正在上传，请稍后再试或先取消恢复', {
          code: 'RESTORE_LOCKED',
          restoreBatchId: lockResult.lock && lockResult.lock.restoreBatchId,
          lockedAt: lockResult.lock && lockResult.lock.lockedAt
        })
      }

      try {
        const allCloudRecords = await fetchAllRecords(records, wxContext.OPENID, { includeStaged: true })
        const visibleCloudRecords = allCloudRecords.filter(item => !item.replacing)
        const staleStagedRecords = allCloudRecords.filter(item => item.replacing)

        for (const item of staleStagedRecords) {
          await records.doc(item._id).remove()
        }

        try {
          const jobRes = await restoreJobs.add({
            data: {
              _openid: wxContext.OPENID,
              restoreBatchId,
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

      const uploadedRecords = []
      let failed = 0

      for (const localRecord of localRecords) {
        if (!localRecord.id || localRecord.deletedAt) {
          continue
        }

        try {
          const createRes = await records.add({
            data: {
              _openid: wxContext.OPENID,
              ...buildRecordData(localRecord, true),
              restoreBatchId,
              replacing: true
            }
          })
          uploadedRecords.push({
            ...localRecord,
            _id: createRes._id,
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
      const allCloudRecords = await fetchAllRecords(records, wxContext.OPENID, { includeStaged: true })
      const visibleCloudRecords = allCloudRecords.filter(item => !item.replacing && item.restoreBatchId !== restoreBatchId)
      const restoredMeta = await saveDictionaryState(userMeta, wxContext.OPENID, routes, plates, routesMeta, platesMeta)

      await revealStagedRecords(records, stagedRecords)

      for (const item of visibleCloudRecords) {
        await records.doc(item._id).remove()
      }
      await releaseRestoreLock(userMeta, wxContext.OPENID, restoreBatchId, 'completed')

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
        restoreBatchId,
        restoreJobId,
        cursorAt: actionStartedAt,
        ...restoredMeta
      })
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

      const cloudRecords = await fetchAllRecords(records, wxContext.OPENID)
      const cloudMap = new Map()
      const mergedMap = new Map()
      const failedSyncIds = []

      cloudRecords.forEach(record => {
        const key = record.id || record._id
        cloudMap.set(key, record)
        mergedMap.set(key, {
          ...record,
          id: record.id || record._id,
          synced: true
        })
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
              const localVersion = getRecordVersion(localRecord)
              const cloudVersion = getRecordVersion(cloudRecord)
              if (localRecord.synced === false || localVersion >= cloudVersion) {
                await records.doc(cloudRecord._id).update({
                  data: buildRecordData(localRecord)
                })
                mergedMap.set(recordId, {
                  ...cloudRecord,
                  ...localRecord,
                  _id: cloudRecord._id,
                  id: recordId,
                  synced: true
                })
                continue
              }
            } else {
              mergedMap.delete(recordId)
              continue
            }
          }

          if (!cloudRecord) {
            const createRes = await records.add({
              data: {
                _openid: wxContext.OPENID,
                ...buildRecordData(localRecord, true)
              }
            })

            mergedMap.set(recordId, {
              ...localRecord,
              id: recordId,
              _id: createRes._id,
              synced: true
            })
            continue
          }

          const localVersion = getRecordVersion(localRecord)
          const cloudVersion = getRecordVersion(cloudRecord)

          if (localRecord.synced === false) {
            if (localVersion >= cloudVersion) {
              await records.doc(cloudRecord._id).update({
                data: buildRecordData(localRecord)
              })
              mergedMap.set(recordId, {
                ...cloudRecord,
                ...localRecord,
                _id: cloudRecord._id,
                id: recordId,
                synced: true
              })
            } else {
              mergedMap.set(recordId, {
                ...cloudRecord,
                id: recordId,
                synced: true
              })
            }
            continue
          }

          if (localVersion > cloudVersion) {
            mergedMap.set(recordId, {
              ...cloudRecord,
              ...localRecord,
              _id: cloudRecord._id,
              id: recordId,
              synced: true
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
        cursorAt: actionStartedAt
      })
    }

    return failure('未知操作')
  } catch (err) {
    return failure(err.message, { error: err.message })
  }
}
