const test = require('node:test')
const assert = require('node:assert/strict')

const { commitAtomically } = require('../utils/storageTransaction.js')

test('rolls back completed writes when a later local storage write fails', () => {
  const state = { records: ['old-record'], routes: ['old-route'], plates: ['old-plate'] }
  const adapter = {
    read(key, fallback) {
      return Object.prototype.hasOwnProperty.call(state, key) ? state[key] : fallback
    },
    write(key, value) {
      if (key === 'routes' && value[0] === 'new-route') return false
      state[key] = value
      return true
    }
  }

  const committed = commitAtomically(adapter, [
    { key: 'records', value: ['new-record'], fallback: [] },
    { key: 'routes', value: ['new-route'], fallback: [] },
    { key: 'plates', value: ['new-plate'], fallback: [] }
  ])

  assert.equal(committed, false)
  assert.deepEqual(state, { records: ['old-record'], routes: ['old-route'], plates: ['old-plate'] })
})

test('commits all writes when every local storage write succeeds', () => {
  const state = { records: [], routes: [] }
  const adapter = {
    read(key, fallback) {
      return Object.prototype.hasOwnProperty.call(state, key) ? state[key] : fallback
    },
    write(key, value) {
      state[key] = value
      return true
    }
  }

  assert.equal(commitAtomically(adapter, [
    { key: 'records', value: ['record'], fallback: [] },
    { key: 'routes', value: ['route'], fallback: [] }
  ]), true)
  assert.deepEqual(state, { records: ['record'], routes: ['route'] })
})
