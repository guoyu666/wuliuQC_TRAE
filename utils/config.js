module.exports = {
  cloud: {
    env: 'cloud1-9gvo70lwa48bb03a',
    syncFunctionName: 'syncRecords',
    protocolVersion: 6,
    minClientProtocolVersion: 5,
    fetchInterval: 60 * 1000,
    restoreChunkSize: 50,
    cursorOverlap: 3000,
    presenceRefreshInterval: 30 * 1000
  },
  storage: {
    schemaVersion: 2
  },
  history: {
    pageSize: 10
  }
}
