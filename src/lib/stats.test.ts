import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStats, search, alarmTh, alarmCheck, trendOf, toCsv, daysAgo } from './stats.ts'

const today = new Date(2026, 9, 7) // 7 Oct 2026
const item = (id: string, over = {}) => ({ id, code: 'K' + id, tag: 'Shoe ' + id, colour: 'Black', brand: 'Bata', details: '', note: '', category_id: 'c1', size_system: 'UK' as const, size_from: 4, size_to: 6, alarm_on: null, alarm_th: null, alarm_why: '', removed_at: null, ...over })
const cats = [{ id: 'c1', name: 'School shoes', hue: 250, sort_order: 0, alarm_on: true, alarm_th: 1 }]

test('daysAgo uses local calendar days', () => {
  assert.equal(daysAgo('2026-10-07', today), 0)
  assert.equal(daysAgo('2026-09-30', today), 7)
})

test('buildStats windows, cover and months', () => {
  const stock: Record<string, number> = { 'a|4': 3, 'a|5': 0, 'a|6': -1 }
  const st = (id: string, z: number) => stock[id + '|' + z] || 0
  const daily = [
    { item_id: 'a', size: 4, day: '2026-10-07', pairs: 2 }, // today
    { item_id: 'a', size: 5, day: '2026-09-20', pairs: 3 }, // 17 days ago
    { item_id: 'a', size: 5, day: '2026-07-20', pairs: 8 }, // 79 days ago
    { item_id: 'a', size: 5, day: '2026-06-01', pairs: 99 }, // outside 90 days: ignored
  ]
  const monthly = [
    { item_id: 'a', month: '2026-10-01', pairs: 2, last_day: '2026-10-07' },
    { item_id: 'a', month: '2025-11-01', pairs: 5, last_day: '2025-11-12' },
    { item_id: 'a', month: '2025-10-01', pairs: 50, last_day: '2025-10-30' }, // 12 months back: ignored
  ]
  const S = buildStats([item('a')], st, daily, monthly, today).a
  assert.deepEqual([S.s7, S.s30, S.s90, S.s365], [2, 5, 13, 7])
  assert.equal(S.mon[11], 2)
  assert.equal(S.mon[0], 5)
  assert.equal(S.last, 0)
  assert.equal(S.weekly[7], 2)
  assert.deepEqual(S.sz30, { 4: 2, 5: 3 })
  assert.equal(S.total, 2)
  assert.equal(S.coverTxt, '2 wk') // 2 pairs / (13/13 a week)
})

test('coverTxt edge cases', () => {
  const S = buildStats([item('a'), item('b')], (id) => (id === 'a' ? 0 : 5), [], [], today)
  assert.equal(S.a.coverTxt, 'Out')
  assert.equal(S.b.coverTxt, 'No sales')
})

test('search matches every word, tag prefix first', () => {
  const items = [item('1', { tag: 'Capal Almond Black' }), item('2', { tag: 'Y329', colour: 'White' }), item('3', { tag: 'Black Y329' })]
  const names = (q: string) => search(q, items, () => 'School shoes').map(i => i.tag)
  assert.deepEqual(names('capal black'), ['Capal Almond Black'])
  assert.deepEqual(names('y329'), ['Y329', 'Black Y329'])
  assert.deepEqual(names('school y329').length, 2)
})

test('alarm: shoe setting beats category', () => {
  assert.equal(alarmTh(item('a'), cats), 1)
  assert.equal(alarmTh(item('a', { alarm_on: false, alarm_th: 3 }), cats), null)
  assert.equal(alarmTh(item('a', { alarm_on: true, alarm_th: 3 }), cats), 3)
})

test('alarmCheck only rings for sizes going down to the level', () => {
  const st = () => 3
  const hits = alarmCheck([{ item_id: 'a', size: 4, qty: -2 }, { item_id: 'a', size: 5, qty: -1 }, { item_id: 'a', size: 6, qty: 2 }], [item('a')], cats, st)
  assert.deepEqual(hits.map(h => [h.size, h.v]), [[4, 1]])
})

test('trend and csv', () => {
  assert.equal(trendOf([0, 0, 0, 0, 0, 10, 10, 10, 15, 15, 15, 0]), 50)
  assert.equal(trendOf(Array(12).fill(0)), null)
  assert.equal(toCsv([['a,b', 'say "hi"', 3]]), '"a,b","say ""hi""",3')
})
