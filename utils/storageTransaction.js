function commitAtomically(adapter, entries) {
  if (!adapter || typeof adapter.read !== 'function' || typeof adapter.write !== 'function') {
    throw new Error('存储事务适配器无效')
  }

  const previous = entries.map(entry => ({
    key: entry.key,
    value: adapter.read(entry.key, entry.fallback)
  }))
  const written = []

  for (const entry of entries) {
    if (adapter.write(entry.key, entry.value)) {
      written.push(entry)
      continue
    }

    written.reverse().forEach(item => {
      const snapshot = previous.find(current => current.key === item.key)
      adapter.write(item.key, snapshot && snapshot.value)
    })
    return false
  }

  return true
}

module.exports = {
  commitAtomically
}
