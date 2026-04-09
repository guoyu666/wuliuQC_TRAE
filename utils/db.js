const util = require('./util.js')

async function addRecord(record) {
  const localRecords = wx.getStorageSync('records') || []
  const newRecord = {
    ...record,
    id: Date.now().toString(),
    createTime: util.formatTime(new Date())
  }
  localRecords.push(newRecord)
  wx.setStorageSync('records', localRecords)
  return { success: true, id: newRecord.id }
}

async function getTodayRecords() {
  const today = util.formatDate(new Date())
  const records = wx.getStorageSync('records') || []
  const todayRecords = records.filter(r => r.date === today)
  return todayRecords
}

async function getAllRecords() {
  const records = wx.getStorageSync('records') || []
  return records.sort((a, b) => new Date(b.createTime) - new Date(a.createTime))
}

async function deleteRecord(id) {
  const records = wx.getStorageSync('records') || []
  const newRecords = records.filter(r => r.id !== id)
  wx.setStorageSync('records', newRecords)
  return { success: true }
}

async function updateRecord(id, updates) {
  const records = wx.getStorageSync('records') || []
  const newRecords = records.map(r => {
    if (r.id === id) {
      return { ...r, ...updates }
    }
    return r
  })
  wx.setStorageSync('records', newRecords)
  return { success: true }
}

async function getRecordById(id) {
  const records = wx.getStorageSync('records') || []
  return records.find(r => r.id === id) || null
}

async function syncLocalToCloud() {
  return { synced: 0, message: '云同步已禁用，当前使用本地存储' }
}

module.exports = {
  addRecord,
  getTodayRecords,
  getAllRecords,
  deleteRecord,
  updateRecord,
  getRecordById,
  syncLocalToCloud
}
