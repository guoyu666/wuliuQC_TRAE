function buildBackupData(payload) {
  const {
    records = [],
    routes = [],
    plates = [],
    routesMeta = {},
    platesMeta = {},
    schemaVersion = 1
  } = payload || {}

  return {
    version: '2.0',
    schemaVersion,
    timestamp: new Date().toISOString(),
    records,
    routes,
    plates,
    routesMeta,
    platesMeta
  }
}

function parseBackup(jsonStr) {
  let data

  try {
    data = JSON.parse(jsonStr)
  } catch (err) {
    return { success: false, message: '解析备份文件失败' }
  }

  if (!data || !data.version || !Array.isArray(data.records)) {
    return { success: false, message: '无效的备份文件格式' }
  }

  return { success: true, data }
}

function inspectBackup(jsonStr) {
  const parsed = parseBackup(jsonStr)
  if (!parsed.success) return parsed

  const data = parsed.data
  return {
    success: true,
    version: data.version,
    schemaVersion: data.schemaVersion || 1,
    timestamp: data.timestamp || '',
    recordCount: Array.isArray(data.records) ? data.records.length : 0,
    routeCount: Array.isArray(data.routes) ? data.routes.length : 0,
    plateCount: Array.isArray(data.plates) ? data.plates.length : 0,
    isLegacy: data.version !== '2.0'
  }
}

module.exports = {
  buildBackupData,
  parseBackup,
  inspectBackup
}
