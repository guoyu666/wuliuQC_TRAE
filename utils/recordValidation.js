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

function normalizeText(value, field, required) {
  const text = value === undefined || value === null ? '' : String(value).trim()
  const limit = TEXT_LIMITS[field]

  if (required && !text) {
    return { success: false, message: field === 'routeName' ? '请输入线路名称' : '请输入车牌号' }
  }
  if (text.length > limit) {
    return { success: false, message: `${field}长度不能超过 ${limit} 个字符` }
  }
  return { success: true, value: text }
}

function normalizeCount(value, field) {
  const normalized = value === undefined || value === null || value === '' ? 0 : Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    return { success: false, message: `${field}必须是非负整数` }
  }
  return { success: true, value: normalized }
}

function validateRecord(record, options = {}) {
  const { requireId = false, allowDeleted = true } = options
  if (!isPlainObject(record)) {
    return { success: false, message: '记录格式无效' }
  }

  const id = record.id === undefined || record.id === null ? '' : String(record.id).trim()
  if (requireId && !id) {
    return { success: false, message: '记录ID不能为空' }
  }

  const deletedAt = Number(record.deletedAt || 0)
  if (deletedAt) {
    if (!allowDeleted || !Number.isFinite(deletedAt) || deletedAt <= 0) {
      return { success: false, message: '删除时间无效' }
    }
    return {
      success: true,
      record: {
        ...record,
        ...(id ? { id } : {}),
        deletedAt
      }
    }
  }

  if (!isValidDate(record.date)) {
    return { success: false, message: '记录日期无效' }
  }

  const routeName = normalizeText(record.routeName, 'routeName', true)
  if (!routeName.success) return routeName
  const plateNumber = normalizeText(record.plateNumber, 'plateNumber', true)
  if (!plateNumber.success) return plateNumber
  const remark = normalizeText(record.remark, 'remark', false)
  if (!remark.success) return remark

  const normalized = {
    ...record,
    ...(id ? { id } : {}),
    date: record.date,
    routeName: routeName.value,
    plateNumber: plateNumber.value,
    remark: remark.value
  }

  for (const field of COUNT_FIELDS) {
    const count = normalizeCount(record[field], field)
    if (!count.success) return count
    normalized[field] = count.value
  }

  return { success: true, record: normalized }
}

module.exports = {
  COUNT_FIELDS,
  TEXT_LIMITS,
  isValidDate,
  validateRecord
}
