module.exports = {
  cloud: {
    env: 'cloud1-9gvo70lwa48bb03a',
    syncFunctionName: 'syncRecords',
    protocolVersion: 5,
    minClientProtocolVersion: 5,
    fetchInterval: 60 * 1000,
    restoreChunkSize: 50
  },
  storage: {
    schemaVersion: 2
  },
  history: {
    pageSize: 10
  }
}
