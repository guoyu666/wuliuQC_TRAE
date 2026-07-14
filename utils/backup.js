const config = require('./config.js')

const COUNT_FIELDS = ['sendBlueOut', 'sendRedOut', 'blueOut', 'blueIn', 'redOut', 'redIn']
const TEXT_LIMITS = {
  routeName: 100,
  plateNumber: 100,
  remark: 2000
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isValidDate(value) {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const parsed = new Date(year, month, day)
  return parsed.getFullYear() === year && parsed.getMonth() === month && parsed.getDate() === day
}

function normalizeText(value, field, recordIndex) {
  const text = value === undefined || value === null ? '' : String(value).trim()
  const limit = TEXT_LIMITS[field]
  if (text.length > limit) {
    throw new Error(`第 ${recordIndex + 1} 条记录的${field}长度超过 ${limit} 个字符`)
  }
  return text
}

function normalizeCount(value, field, recordIndex) {
  const normalized = value === undefined || value === null || value === '' ? 0 : Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`第 ${recordIndex + 1} 条记录的${field}必须是非负安全整数`)
  }
  return normalized
}

function normalizeNameList(value, field) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${field}格式无效`)
  return Array.from(new Set(value.map(item => String(item || '').trim()).filter(Boolean)))
}

function normalizeBackupData(data) {
  const currentSchemaVersion = Number(config.storage && config.storage.schemaVersion || 1)
  const schemaVersion = Number(data.schemaVersion || 1)
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error('备份 schemaVersion 无效')
  }
  if (schemaVersion > currentSchemaVersion) {
    throw new Error('备份文件来自更高版本，请先更新小程序')
  }

  const recordIds = new Set()
  const records = data.records.map((record, index) => {
    if (!isPlainObject(record)) {
      throw new Error(`第 ${index + 1} 条记录格式无效`)
    }
    if (!isValidDate(record.date)) {
      throw new Error(`第 ${index + 1} 条记录日期无效`)
    }

    const id = record.id || record._id
    if (id !== undefined && id !== null && String(id).trim()) {
      const normalizedId = String(id).trim()
      if (recordIds.has(normalizedId)) {
        throw new Error(`第 ${index + 1} 条记录ID重复`)
      }
      recordIds.add(normalizedId)
    }

    const normalized = {
      ...record,
      date: record.date,
      routeName: normalizeText(record.routeName, 'routeName', index),
      plateNumber: normalizeText(record.plateNumber, 'plateNumber', index),
      remark: normalizeText(record.remark, 'remark', index)
    }
    COUNT_FIELDS.forEach(field => {
      normalized[field] = normalizeCount(record[field], field, index)
    })
    return normalized
  })

  if (data.routesMeta !== undefined && !isPlainObject(data.routesMeta)) {
    throw new Error('线路元数据格式无效')
  }
  if (data.platesMeta !== undefined && !isPlainObject(data.platesMeta)) {
    throw new Error('车牌元数据格式无效')
  }

  return {
    ...data,
    schemaVersion,
    records,
    routes: normalizeNameList(data.routes, '线路列表'),
    plates: normalizeNameList(data.plates, '车牌列表'),
    routesMeta: data.routesMeta || {},
    platesMeta: data.platesMeta || {}
  }
}

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

  if (!isPlainObject(data) || !data.version || !Array.isArray(data.records)) {
    return { success: false, message: '无效的备份文件格式' }
  }

  try {
    return { success: true, data: normalizeBackupData(data) }
  } catch (err) {
    return { success: false, message: err.message || '备份数据校验失败' }
  }
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
