// node --test src/lib/tip.test.js — чаевые в окне оплаты.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TIP_FIXED, TIP_PERCENT, isValidTip, tipAmount, sameTip, tipLabel } from './tip.js'

test('наборы значений — ровно те, что согласованы', () => {
  assert.deepEqual(TIP_FIXED, [100, 200, 300, 500, 1000])
  assert.deepEqual(TIP_PERCENT, [3, 5, 10, 15])
})

test('фиксированные чаевые не зависят от чека', () => {
  assert.equal(tipAmount({ kind: 'fixed', value: 300 }, 1234), 300)
  assert.equal(tipAmount({ kind: 'fixed', value: 1000 }, 0), 1000)
})

test('проценты — от чека, округление до рубля', () => {
  assert.equal(tipAmount({ kind: 'percent', value: 10 }, 2450), 245)
  assert.equal(tipAmount({ kind: 'percent', value: 5 }, 2450), 123) // 122.5 → 123
  assert.equal(tipAmount({ kind: 'percent', value: 3 }, 1000), 30)
  assert.equal(tipAmount({ kind: 'percent', value: 15 }, 999), 150) // 149.85 → 150
})

test('нет выбора, пустой чек или чужое значение — 0', () => {
  assert.equal(tipAmount(null, 1000), 0)
  assert.equal(tipAmount({ kind: 'percent', value: 10 }, 0), 0)
  assert.equal(tipAmount({ kind: 'percent', value: 10 }, 'abc'), 0)
  assert.equal(tipAmount({ kind: 'percent', value: 7 }, 1000), 0)
  assert.equal(tipAmount({ kind: 'fixed', value: 150 }, 1000), 0)
  assert.equal(tipAmount({ kind: 'other', value: 100 }, 1000), 0)
})

test('isValidTip и sameTip', () => {
  assert.equal(isValidTip({ kind: 'fixed', value: 500 }), true)
  assert.equal(isValidTip({ kind: 'percent', value: 15 }), true)
  assert.equal(isValidTip({ kind: 'percent', value: 500 }), false)
  assert.equal(isValidTip(undefined), false)
  assert.equal(sameTip({ kind: 'fixed', value: 100 }, { kind: 'fixed', value: 100 }), true)
  assert.equal(sameTip({ kind: 'fixed', value: 100 }, { kind: 'percent', value: 100 }), false)
  assert.equal(sameTip(null, null), false)
})

test('подпись кнопки', () => {
  assert.equal(tipLabel({ kind: 'fixed', value: 200 }, 1000), '200 ₽')
  assert.equal(tipLabel({ kind: 'percent', value: 10 }, 2000), '10% · 200 ₽')
  assert.equal(tipLabel({ kind: 'percent', value: 10 }, 0), '10%')
  assert.equal(tipLabel(null, 100), '')
})
