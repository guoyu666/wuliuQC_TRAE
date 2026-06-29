function next(page, key) {
  const field = `${key}RequestId`
  const requestId = (page[field] || 0) + 1
  page[field] = requestId
  return requestId
}

function isCurrent(page, key, requestId) {
  return page[`${key}RequestId`] === requestId
}

module.exports = {
  next,
  isCurrent
}
