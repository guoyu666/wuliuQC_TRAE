const test = require('node:test')
const assert = require('node:assert/strict')

const clientValidation = require('../utils/recordValidation.js')
const cloudValidation = require('../cloudfunctions/syncRecords/recordValidation.js')

const validRecord = {
  id: 'record-1',
  date: '2026-07-22',
  routeName: '  城际线路  ',
  plateNumber: ' 粤A12345 ',
  sendBlueOut: '1',
  sendRedOut: 0,
  blueOut: 2,
  blueIn: 0,
  redOut: 0,
  redIn: 3,
  remark: '  正常  '
}

for (const [name, validation] of [['client', clientValidation], ['cloud', cloudValidation]]) {
  test(`${name}: normalizes a valid record`, () => {
    const result = validation.validateRecord(validRecord, { requireId: true })
    assert.equal(result.success, true)
    assert.equal(result.record.routeName, '城际线路')
    assert.equal(result.record.plateNumber, '粤A12345')
    assert.equal(result.record.sendBlueOut, 1)
    assert.equal(result.record.remark, '正常')
  })

  test(`${name}: rejects invalid business data`, () => {
    assert.equal(validation.validateRecord({ ...validRecord, date: '2026-02-30' }, { requireId: true }).success, false)
    assert.equal(validation.validateRecord({ ...validRecord, routeName: '   ' }, { requireId: true }).success, false)
    assert.equal(validation.validateRecord({ ...validRecord, blueOut: -1 }, { requireId: true }).success, false)
  })

  test(`${name}: accepts a valid deletion tombstone`, () => {
    const result = validation.validateRecord({ id: 'record-1', deletedAt: Date.now() }, { requireId: true })
    assert.equal(result.success, true)
  })
}
