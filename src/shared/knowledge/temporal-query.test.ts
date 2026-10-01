import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTemporalRange } from './temporal-query'

// Anchor: Wednesday 2024-03-20 15:00 UTC
const AS_OF = Date.UTC(2024, 2, 20, 15)

test('ISO date', () => {
  const r = parseTemporalRange('what happened on 2024-03-05?', AS_OF)!
  assert.equal(r.fromMs, Date.UTC(2024, 2, 5))
  assert.equal(r.toMs, Date.UTC(2024, 2, 6))
})

test('month day year', () => {
  const r = parseTemporalRange('what did we discuss March 5, 2024?', AS_OF)!
  assert.equal(r.fromMs, Date.UTC(2024, 2, 5))
})

test('month day without year resolves to the previous occurrence', () => {
  const r = parseTemporalRange('what did we discuss on february 5?', AS_OF)!
  assert.equal(r.fromMs, Date.UTC(2024, 1, 5))
  const future = parseTemporalRange('remember december 25?', AS_OF)!
  assert.equal(future.fromMs, Date.UTC(2023, 11, 25))
})

test('in <month> <year> → whole month', () => {
  const r = parseTemporalRange('what did I ship in february 2024?', AS_OF)!
  assert.equal(r.fromMs, Date.UTC(2024, 1, 1))
  assert.equal(r.toMs, Date.UTC(2024, 2, 1))
})

test('in <year> → whole year', () => {
  const r = parseTemporalRange('biggest project in 2023?', AS_OF)!
  assert.equal(r.fromMs, Date.UTC(2023, 0, 1))
  assert.equal(r.toMs, Date.UTC(2024, 0, 1))
})

test('yesterday / today / last night', () => {
  assert.equal(parseTemporalRange('what did I do yesterday?', AS_OF)!.fromMs, Date.UTC(2024, 2, 19))
  assert.equal(parseTemporalRange('what did I do today?', AS_OF)!.fromMs, Date.UTC(2024, 2, 20))
  assert.equal(parseTemporalRange('calls from last night?', AS_OF)!.fromMs, Date.UTC(2024, 2, 19))
})

test('N units ago', () => {
  assert.equal(parseTemporalRange('what happened 3 days ago?', AS_OF)!.fromMs, Date.UTC(2024, 2, 17))
  const w = parseTemporalRange('two weeks ago?', AS_OF)!
  assert.ok(w.fromMs <= Date.UTC(2024, 2, 6) && w.toMs >= Date.UTC(2024, 2, 6))
  const m = parseTemporalRange('a month ago?', AS_OF)!
  assert.equal(m.fromMs, Date.UTC(2024, 1, 1))
})

test('last/this week and month', () => {
  // Wednesday 3/20 → this week starts Sunday 3/17, last week is 3/10–3/17.
  const tw = parseTemporalRange('what did we do this week?', AS_OF)!
  assert.equal(tw.fromMs, Date.UTC(2024, 2, 17))
  const lw = parseTemporalRange('last week?', AS_OF)!
  assert.equal(lw.fromMs, Date.UTC(2024, 2, 10))
  assert.equal(lw.toMs, Date.UTC(2024, 2, 17))
  const lm = parseTemporalRange('last month?', AS_OF)!
  assert.equal(lm.fromMs, Date.UTC(2024, 1, 1))
  assert.equal(lm.toMs, Date.UTC(2024, 2, 1))
})

test('weekday names resolve to the most recent occurrence', () => {
  // Asked Wednesday 3/20 → "on monday" = 3/18, "this wednesday" = today.
  assert.equal(parseTemporalRange('the meeting on monday', AS_OF)!.fromMs, Date.UTC(2024, 2, 18))
  assert.equal(parseTemporalRange('this wednesday', AS_OF)!.fromMs, Date.UTC(2024, 2, 20))
  assert.equal(parseTemporalRange('last friday', AS_OF)!.fromMs, Date.UTC(2024, 2, 15))
})

test('recent/lately → trailing 7 days', () => {
  const r = parseTemporalRange('what have I been working on lately?', AS_OF)!
  assert.equal(r.fromMs, AS_OF - 7 * 86_400_000)
})

test('non-temporal questions return null', () => {
  assert.equal(parseTemporalRange('what is my favorite color?', AS_OF), null)
  assert.equal(parseTemporalRange('who is Caroline?', AS_OF), null)
  assert.equal(parseTemporalRange('how many messages did I send?', AS_OF), null)
})
