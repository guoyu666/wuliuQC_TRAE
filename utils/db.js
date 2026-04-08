const util = require('./util.js')

function getDB() {
  if (!wx.cloud) {
    throw new Error('云能力未初始化')
  }
  return wx.cloud.database()
}

async function addRecord(record) {
  const database = getDB()
  const recordsCollection = database.collection('records')
  
  const openid = wx.getStorageSync('openid')
  
  return await recordsCollection.add({
    data: {
      ...record,
      _openid: openid,
      createTime: new Date()
    }
  })
}

async function getTodayRecords() {
  const database = getDB()
  const recordsCollection = database.collection('records')
  const today = util.formatDate(new Date())
  
  const openid = wx.getStorageSync('openid')
  
  try {
    const res = await recordsCollection.where({
      date: today,
      _openid: openid
    }).get()
    
    return res.data
  } catch (err) {
    console.log('云端获取失败，使用本地存储', err)
    const records = wx.getStorageSync('records') || []
    const todayRecords = records.filter(r => r.date === today)
    return todayRecords
  }
}

async function getAllRecords() {
  const database = getDB()
  const recordsCollection = database.collection('records')
  
  const openid = wx.getStorageSync('openid')
  
  try {
    const res = await recordsCollection.where({
      _openid: openid
    }).orderBy('createTime', 'desc').get()
    
    return res.data
  } catch (err) {
    console.log('云端获取失败，使用本地存储', err)
    const records = wx.getStorageSync('records') || []
    return records.sort((a, b) => new Date(b.createTime) - new Date(a.createTime))
  }
}

async function deleteRecord(id) {
  const database = getDB()
  const recordsCollection = database.collection('records')
  
  return await recordsCollection.doc(id).remove()
}

async function syncLocalToCloud() {
  const localRecords = wx.getStorageSync('records') || []
  const openid = wx.getStorageSync('openid')
  
  if (localRecords.length === 0) {
    return { synced: 0 }
  }
  
  const database = getDB()
  const recordsCollection = database.collection('records')
  
  let synced = 0
  for (const record of localRecords) {
    try {
      await recordsCollection.add({
        data: {
          ...record,
          _openid: openid,
          createTime: new Date(record.createTime)
        }
      })
      synced++
    } catch (err) {
      console.error('同步单条记录失败', err)
    }
  }
  
  if (synced === localRecords.length) {
    wx.setStorageSync('records', [])
  }
  
  return { synced }
}

async function getCloudOpenid() {
  try {
    const result = await wx.cloud.callFunction({
      name: 'login'
    })
    return result.openid
  } catch (err) {
    console.error('获取openid失败', err)
    return null
  }
}

module.exports = {
  addRecord,
  getTodayRecords,
  getAllRecords,
  deleteRecord,
  syncLocalToCloud,
  getCloudOpenid
}
