const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const PAGE_SIZE = 100

function normalizeTime(value) {
  if (!value) return new Date(0)

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return new Date(0)
  }

  return parsed
}

function sortRecords(records) {
  return records.sort((a, b) => normalizeTime(b.createTime) - normalizeTime(a.createTime))
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
    'remark'
  ]

  fields.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      data[field] = record[field]
    }
  })

  if (includeCreateTime && record.createTime) {
    const parsed = new Date(record.createTime)
    data.createTime = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  }

  data.syncTime = new Date()
  return data
}

async function fetchAllRecords(recordsCollection, openid) {
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

  return allRecords
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

          if (localRecord.synced === false) {
            await records.doc(cloudRecord._id).update({
              data: buildRecordData(localRecord)
            })
          }

          mergedMap.set(recordId, {
            ...cloudRecord,
            ...localRecord,
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
      const cloudRecords = await fetchAllRecords(records, wxContext.OPENID)

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
