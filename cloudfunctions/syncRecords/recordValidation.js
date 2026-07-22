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

function validateRecord(record, options = {}) {
  const { requireId = false } = options
  if (!isPlainObject(record)) return { success: false, message: '记录格式无效' }

  const id = record.id === undefined || record.id === null ? '' : String(record.id).trim()
  if (requireId && !id) return { success: false, message: '记录ID不能为空' }

  const deletedAt = Number(record.deletedAt || 0)
  if (deletedAt) {
    if (!Number.isFinite(deletedAt) || deletedAt <= 0) {
      return { success: false, message: '删除时间无效' }
    }
    return { success: true, record: { ...record, ...(id ? { id } : {}), deletedAt } }
  }

  if (!isValidDate(record.date)) return { success: false, message: '记录日期无效' }

  const normalized = { ...record, ...(id ? { id } : {}), date: record.date }
  for (const field of ['routeName', 'plateNumber', 'remark']) {
    const text = record[field] === undefined || record[field] === null ? '' : String(record[field]).trim()
    if (field !== 'remark' && !text) {
      return { success: false, message: field === 'routeName' ? '线路名称不能为空' : '车牌号不能为空' }
    }
    if (text.length > TEXT_LIMITS[field]) {
      return { success: false, message: `${field}长度不能超过 ${TEXT_LIMITS[field]} 个字符` }
    }
    normalized[field] = text
  }

  for (const field of COUNT_FIELDS) {
    const value = record[field] === undefined || record[field] === null || record[field] === '' ? 0 : Number(record[field])
    if (!Number.isSafeInteger(value) || value < 0) {
      return { success: false, message: `${field}必须是非负整数` }
    }
    normalized[field] = value
  }

  return { success: true, record: normalized }
}

module.exports = {
  validateRecord
}
