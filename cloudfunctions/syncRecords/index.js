const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

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
              ...record,
              syncTime: new Date()
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
      const { data } = await records
        .where({
          _openid: wxContext.OPENID
        })
        .orderBy('createTime', 'desc')
        .get()

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

      const cloudRecords = (await records
        .where({
          _openid: wxContext.OPENID
        })
        .get()).data

      const localIds = new Set(localRecords.map(r => r.id))
      const onlyInCloud = cloudRecords.filter(r => !localIds.has(r.id))
      const merged = [...localRecords, ...onlyInCloud]

      merged.sort((a, b) => new Date(b.createTime) - new Date(a.createTime))

      return {
        success: true,
        mergedRecords: merged,
        cloudCount: cloudRecords.length,
        localCount: localRecords.length,
        mergedCount: merged.length
      }
    }

    if (action === 'clear') {
      const cloudRecords = (await records
        .where({
          _openid: wxContext.OPENID
        })
        .get()).data

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