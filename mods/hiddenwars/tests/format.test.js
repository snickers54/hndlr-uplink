import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compact, timeAgo, severityMark, row } from '../hooks/format.js'

test('compact renders short numbers unchanged', () => {
  assert.equal(compact(999), '999')
  assert.equal(compact(0), '0')
})

test('compact abbreviates thousands, millions, billions', () => {
  assert.equal(compact(1250), '1.3k')
  assert.equal(compact(1000000), '1M')
  assert.equal(compact(1234567), '1.2M')
  assert.equal(compact(2500000000), '2.5B')
})

test('compact trims trailing .0 and survives junk', () => {
  assert.equal(compact(1000), '1k')
  assert.equal(compact(undefined), '0')
  assert.equal(compact('nope'), '0')
  assert.equal(compact(-4500), '-4.5k')
})

test('timeAgo buckets seconds, minutes, hours, days', () => {
  const now = Date.parse('2026-10-09T12:00:00Z')
  assert.equal(timeAgo('2026-10-09T11:59:45Z', now), '15s ago')
  assert.equal(timeAgo('2026-10-09T11:30:00Z', now), '30m ago')
  assert.equal(timeAgo('2026-10-09T06:00:00Z', now), '6h ago')
  assert.equal(timeAgo('2026-10-07T12:00:00Z', now), '2d ago')
})

test('timeAgo falls back to the raw value on garbage', () => {
  assert.equal(timeAgo('not a date'), 'not a date')
})

test('severityMark maps the four game severities', () => {
  assert.equal(severityMark('danger'), '[!!]')
  assert.equal(severityMark('warning'), '[! ]')
  assert.equal(severityMark('success'), '[ +]')
  assert.equal(severityMark('info'), '[ i]')
  assert.equal(severityMark(undefined), '[ i]')
})

test('row pads the label column', () => {
  assert.equal(row('crypto', '1.2M'), '  crypto        1.2M')
})
