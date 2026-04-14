function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatTime(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

function calculateStats(records) {
  let blueOut = 0, blueIn = 0, redOut = 0, redIn = 0
  records.forEach(r => {
    blueOut += r.blueOut || 0
    blueIn += r.blueIn || 0
    redOut += r.redOut || 0
    redIn += r.redIn || 0
  })
  return { blueOut, blueIn, redOut, redIn }
}

function calculateBarHeights(stats, maxHeight = 160) {
  const maxValue = Math.max(stats.blueOut, stats.blueIn, stats.redOut, stats.redIn, 1)
  return {
    barBlueOut: Math.max(4, (stats.blueOut / maxValue) * maxHeight),
    barBlueIn: Math.max(4, (stats.blueIn / maxValue) * maxHeight),
    barRedOut: Math.max(4, (stats.redOut / maxValue) * maxHeight),
    barRedIn: Math.max(4, (stats.redIn / maxValue) * maxHeight)
  }
}

module.exports = {
  formatDate,
  formatTime,
  calculateStats,
  calculateBarHeights
}