const util = require('./util.js')

function isValidRecordDate(recordOrDate) {
  const date = typeof recordOrDate === 'string' ? recordOrDate : recordOrDate && recordOrDate.date
  return !!util.parseDate(date)
}

function getRecordDate(record) {
  return isValidRecordDate(record) ? record.date : '未知日期'
}

function calculateStats(records = []) {
  return records.reduce((stats, record) => {
    stats.sendBlueOut += record.sendBlueOut || 0
    stats.sendRedOut += record.sendRedOut || 0
    stats.blueOut += record.blueOut || 0
    stats.blueIn += record.blueIn || 0
    stats.redOut += record.redOut || 0
    stats.redIn += record.redIn || 0
    stats.totalOut = stats.blueOut + stats.redOut
    stats.totalIn = stats.blueIn + stats.redIn
    return stats
  }, {
    sendBlueOut: 0,
    sendRedOut: 0,
    blueOut: 0,
    blueIn: 0,
    redOut: 0,
    redIn: 0,
    totalOut: 0,
    totalIn: 0
  })
}

function matchesKeyword(record, keyword) {
  if (!keyword) return true
  const normalized = String(keyword).toLowerCase()
  return ['routeName', 'plateNumber', 'remark'].some(field => {
    return record[field] && String(record[field]).toLowerCase().includes(normalized)
  })
}

function isInDateRange(record, startDate, endDate) {
  if (!isValidRecordDate(record)) return false
  if (startDate && record.date < startDate) return false
  if (endDate && record.date > endDate) return false
  return true
}

function filterRecords(records = [], options = {}) {
  const {
    keyword = '',
    startDate = '',
    endDate = '',
    routeName = '',
    month = '',
    year = ''
  } = options

  return records.filter(record => {
    if (routeName && record.routeName !== routeName) return false
    if (keyword && !matchesKeyword(record, keyword)) return false
    if ((startDate || endDate) && !isInDateRange(record, startDate, endDate)) return false
    if (month && (!isValidRecordDate(record) || !record.date.startsWith(month))) return false
    if (year && (!isValidRecordDate(record) || !record.date.startsWith(year))) return false
    return true
  })
}

function groupByDate(records = [], summaryRecords = records) {
  const groups = {}

  records.forEach(record => {
    const date = getRecordDate(record)
    if (!groups[date]) {
      groups[date] = {
        date,
        blueOut: 0,
        blueIn: 0,
        redOut: 0,
        redIn: 0,
        records: []
      }
    }
    groups[date].records.push(record)
  })

  summaryRecords.forEach(record => {
    const date = getRecordDate(record)
    if (!groups[date]) return

    groups[date].blueOut += record.blueOut || 0
    groups[date].blueIn += record.blueIn || 0
    groups[date].redOut += record.redOut || 0
    groups[date].redIn += record.redIn || 0
  })

  return Object.values(groups).sort((a, b) => {
    if (a.date === '未知日期') return 1
    if (b.date === '未知日期') return -1
    return b.date.localeCompare(a.date)
  })
}

function groupRouteSummary(records = []) {
  const routeGrouped = {}

  records.forEach(record => {
    const routeName = record.routeName || '未知'
    if (!routeGrouped[routeName]) {
      routeGrouped[routeName] = {
        routeName,
        sendBlueOut: 0,
        sendRedOut: 0,
        blueOut: 0,
        blueIn: 0,
        redOut: 0,
        redIn: 0,
        recordCount: 0
      }
    }

    routeGrouped[routeName].sendBlueOut += record.sendBlueOut || 0
    routeGrouped[routeName].sendRedOut += record.sendRedOut || 0
    routeGrouped[routeName].blueOut += record.blueOut || 0
    routeGrouped[routeName].blueIn += record.blueIn || 0
    routeGrouped[routeName].redOut += record.redOut || 0
    routeGrouped[routeName].redIn += record.redIn || 0
    routeGrouped[routeName].recordCount += 1
  })

  return Object.values(routeGrouped).sort((a, b) => b.blueOut + b.redOut - (a.blueOut + a.redOut))
}

module.exports = {
  isValidRecordDate,
  calculateStats,
  filterRecords,
  groupByDate,
  groupRouteSummary
}
