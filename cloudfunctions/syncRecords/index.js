const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const PAGE_SIZE = 100

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

  const { action, localRecords } = event

  try {
    if (action === 'upload') {
      let synced = 0
      let failed = 0

      for (const record of localRecords) {
        try {
          await records.add({
            data: {
              _openid: wxContext.OPENID,
              ...buildRecordData(record, true)
            }
          })
          synced++
        } catch (err) {
          console.error('同步单条记录失败', err)
          failed++
        }
      }

      return {
        success: true,
        synced,
        failed,
        total: localRecords.length
      }
    }

    if (action === 'download') {
      const data = sortRecords(await fetchAllRecords(records, wxContext.OPENID))

      return {
        success: true,
        records: data,
        count: data.length
      }
    }

    if (action === 'replace') {
      if (!localRecords || !Array.isArray(localRecords)) {
        return {
          success: false,
          message: '无效的本地数据'
        }
      }

      const restoreBatchId = `restore_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const allCloudRecords = await fetchAllRecords(records, wxContext.OPENID, { includeStaged: true })
      const visibleCloudRecords = allCloudRecords.filter(record => !record.replacing)
      const staleStagedRecords = allCloudRecords.filter(record => record.replacing)

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

        return {
          success: false,
          message: '恢复数据上传不完整，已保留原云端数据',
          mergedRecords,
          cloudCount: visibleCloudRecords.length,
          localCount: localRecords.length,
          mergedCount: mergedRecords.length,
          failedCount: failed
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

      return {
        success: true,
        mergedRecords: merged,
        cloudCount: visibleCloudRecords.length,
        localCount: localRecords.length,
        mergedCount: merged.length,
        failedCount: failed
      }
    }

    if (action === 'merge') {
      if (!localRecords || !Array.isArray(localRecords)) {
        return {
          success: false,
          message: '无效的本地数据'
        }
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

      return {
        success: true,
        mergedRecords: merged,
        cloudCount: cloudRecords.length,
        localCount: localRecords.length,
        mergedCount: merged.length,
        failedCount: failedSyncIds.length,
        failedSyncIds
      }
    }

    if (action === 'clear') {
      const cloudRecords = await fetchAllRecords(records, wxContext.OPENID, { includeStaged: true })

      for (const record of cloudRecords) {
        try {
          await records.doc(record._id).remove()
        } catch (err) {
          console.error('删除云端记录失败', err)
        }
      }

      return {
        success: true,
        deleted: cloudRecords.length
      }
    }

    return {
      success: false,
      message: '未知操作'
    }
  } catch (err) {
    return {
      success: false,
      error: err.message
    }
  }
}
