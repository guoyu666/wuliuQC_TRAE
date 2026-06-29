const cloud = require('wx-server-sdk')
const config = require('./config.js')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const PAGE_SIZE = config.pageSize
const MIN_CLIENT_PROTOCOL_VERSION = config.minClientProtocolVersion
const CLOUD_PROTOCOL_VERSION = config.protocolVersion

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
  const { includeStaged = false } = options
  const allRecords = []
  let skip = 0

  while (true) {
    const res = await recordsCollection
      .where({ _openid: openid })
      .skip(skip)
      .limit(PAGE_SIZE)
      .get()

    allRecords.push(...res.data)

    if (res.data.length < PAGE_SIZE) {
      break
    }

    skip += res.data.length
  }

  return includeStaged ? allRecords : allRecords.filter(record => !record.replacing)
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const db = cloud.database()
  const records = db.collection('records')
  const userMeta = db.collection('userMeta')
  const restoreJobs = db.collection('restoreJobs')

  const { action, localRecords, record, id, protocolVersion, routes, plates, routesMeta, platesMeta, deletedRoutes, deletedPlates, mode } = event

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

        await records.doc(item._id).remove()
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
      const data = sortRecords(await fetchAllRecords(records, wxContext.OPENID))

      return success({
        records: data,
        count: data.length
      })
    }

    if (action === 'replace' || action === 'restoreAll') {
      if (!localRecords || !Array.isArray(localRecords)) {
        return failure('无效的本地数据')
      }

      const restoreBatchId = `restore_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      let restoreJobId = ''
      const allCloudRecords = await fetchAllRecords(records, wxContext.OPENID, { includeStaged: true })
      const visibleCloudRecords = allCloudRecords.filter(record => !record.replacing)
      const staleStagedRecords = allCloudRecords.filter(record => record.replacing)

      if (action === 'restoreAll') {
        try {
          const jobRes = await restoreJobs.add({
            data: {
              _openid: wxContext.OPENID,
              restoreBatchId,
              status: 'staging',
              localCount: localRecords.length,
              cloudCount: visibleCloudRecords.length,
              createdAt: Date.now(),
              syncTime: new Date()
            }
          })
          restoreJobId = jobRes._id
        } catch (err) {
          console.error('记录恢复批次状态失败', err)
        }
      }

      for (const record of staleStagedRecords) {
        await records.doc(record._id).remove()
      }

      const mergedRecords = []
      const stagedIds = []
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
          stagedIds.push(createRes._id)
          mergedRecords.push({
            ...localRecord,
            _id: createRes._id,
            synced: true
          })
        } catch (err) {
          console.error('替换上传单条记录失败', localRecord.id, err)
          failed++
          mergedRecords.push({
            ...localRecord,
            synced: false
          })
        }
      }

      if (failed > 0) {
        for (const stagedId of stagedIds) {
          try {
            await records.doc(stagedId).remove()
          } catch (err) {
            console.error('清理失败恢复批次记录失败', stagedId, err)
          }
        }

        if (restoreJobId) {
          try {
            await restoreJobs.doc(restoreJobId).update({
              data: {
                status: 'failed',
                failedCount: failed,
                failedAt: Date.now(),
                syncTime: new Date()
              }
            })
          } catch (err) {
            console.error('更新恢复批次失败状态失败', err)
          }
        }

        return failure('恢复数据上传不完整，已保留原云端数据', {
          mergedRecords,
          cloudCount: visibleCloudRecords.length,
          localCount: localRecords.length,
          mergedCount: mergedRecords.length,
          failedCount: failed
        })
      }

      let restoredRoutes = null
      let restoredPlates = null
      let restoredRoutesMeta = null
      let restoredPlatesMeta = null

      if (action === 'restoreAll') {
        restoredRoutesMeta = normalizeDictionaryMeta(routesMeta, routes || [])
        restoredPlatesMeta = normalizeDictionaryMeta(platesMeta, plates || [])
        restoredRoutes = getVisibleNamesFromMeta(restoredRoutesMeta)
        restoredPlates = getVisibleNamesFromMeta(restoredPlatesMeta)

        const existingMeta = await userMeta
          .where({
            _openid: wxContext.OPENID,
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
              _openid: wxContext.OPENID,
              ...metaData
            }
          })
        }
      }

      for (const record of visibleCloudRecords) {
        await records.doc(record._id).remove()
      }

      for (const stagedId of stagedIds) {
        await records.doc(stagedId).update({
          data: {
            replacing: false
          }
        })
      }

      const merged = sortRecords(mergedRecords)

      if (restoreJobId) {
        try {
          await restoreJobs.doc(restoreJobId).update({
            data: {
              status: 'completed',
              mergedCount: merged.length,
              completedAt: Date.now(),
              syncTime: new Date()
            }
          })
        } catch (err) {
          console.error('更新恢复批次完成状态失败', err)
        }
      }

      return success({
        mergedRecords: merged,
        cloudCount: visibleCloudRecords.length,
        localCount: localRecords.length,
        mergedCount: merged.length,
        failedCount: failed,
        routes: restoredRoutes,
        plates: restoredPlates,
        routesMeta: restoredRoutesMeta,
        platesMeta: restoredPlatesMeta,
        restoreBatchId,
        restoreJobId
      })
    }

    if (action === 'merge') {
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
                await records.doc(cloudRecord._id).remove()
                mergedMap.delete(recordId)
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
        failedSyncIds
      })
    }

    return failure('未知操作')
  } catch (err) {
    return failure(err.message, { error: err.message })
  }
}
