import assert from 'node:assert/strict'
import test from 'node:test'
import { RANK_REBALANCE_LENGTH, compareRanked, isValidRank, needsRebalance, rankBetween, rankForSlot, spreadRanks } from './rank'

function sorted(values: string[]) {
  return [...values].sort()
}

test('spreadRanks returns strictly increasing valid ranks', () => {
  for (const count of [1, 2, 3, 61, 62, 63, 500, 5000]) {
    const ranks = spreadRanks(count)
    assert.equal(ranks.length, count)
    assert.deepEqual(ranks, sorted(ranks))
    assert.equal(new Set(ranks).size, count)
    for (const rank of ranks) assert.ok(isValidRank(rank), rank)
  }
  assert.deepEqual(spreadRanks(0), [])
})

test('rankBetween handles an empty list, the first slot, the last slot and a gap', () => {
  const only = rankBetween(null, null)
  assert.ok(isValidRank(only))
  const first = rankBetween(null, only)
  const last = rankBetween(only, null)
  assert.ok(first < only && only < last)
  const middle = rankBetween(first, only)
  assert.ok(first < middle && middle < only)
})

test('rankBetween keeps working at the ends of the alphabet', () => {
  const high = rankBetween('z', null)
  assert.ok(high > 'z' && isValidRank(high))
  const low = rankBetween(null, '1')
  assert.ok(low < '1' && isValidRank(low))
  const tight = rankBetween('1', '2')
  assert.ok(tight > '1' && tight < '2')
  const adjacent = rankBetween('z', 'z1')
  assert.ok(adjacent > 'z' && adjacent < 'z1')
})

test('rankBetween with equal or reversed neighbours lands after the first without throwing', () => {
  const equal = rankBetween('M', 'M')
  assert.ok(equal > 'M')
  const reversed = rankBetween('Q', 'F')
  assert.ok(reversed > 'Q')
})

test('rankBetween rejects ranks that are not valid', () => {
  assert.throws(() => rankBetween('a0', null))
  assert.throws(() => rankBetween(null, 'a-b'))
})

test('inserting repeatedly in one gap stays ordered and eventually asks for a rebalance', () => {
  const [low, high] = ['M', 'N']
  let after = high
  let flagged = false
  for (let i = 0; i < 300; i += 1) {
    const next = rankBetween(low, after)
    assert.ok(next > low && next < after, `${low} < ${next} < ${after}`)
    after = next
    if (needsRebalance(next)) flagged = true
  }
  assert.ok(flagged, `a rank reaches ${RANK_REBALANCE_LENGTH} characters`)
})

test('inserting at the very end and very start many times stays ordered', () => {
  let last = rankBetween(null, null)
  for (let i = 0; i < 200; i += 1) {
    const next = rankBetween(last, null)
    assert.ok(next > last)
    last = next
  }
  let first = rankBetween(null, null)
  for (let i = 0; i < 200; i += 1) {
    const next = rankBetween(null, first)
    assert.ok(next < first && isValidRank(next))
    first = next
  }
})

test('a random sequence of inserts always matches the position it was asked for', () => {
  let seed = 7
  const random = () => ((seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296) / 4_294_967_296)
  const list: string[] = []
  for (let i = 0; i < 400; i += 1) {
    const slot = Math.floor(random() * (list.length + 1))
    const rank = rankBetween(list[slot - 1] ?? null, list[slot] ?? null)
    list.splice(slot, 0, rank)
  }
  assert.deepEqual(list, sorted(list))
  assert.equal(new Set(list).size, list.length)
})

test('rankForSlot places an item between its neighbours and flags long ranks', () => {
  const column = [{ rank: 'F' }, { rank: 'M' }, { rank: 'T' }]
  assert.ok(rankForSlot(column, 0).rank < 'F')
  const mid = rankForSlot(column, 1).rank
  assert.ok(mid > 'F' && mid < 'M')
  assert.ok(rankForSlot(column, 3).rank > 'T')
  assert.ok(rankForSlot(column, 99).rank > 'T')
  assert.ok(rankForSlot([], 0).rank)
  assert.equal(rankForSlot(column, 1).rebalance, false)
  assert.equal(rankForSlot([{ rank: 'a'.repeat(RANK_REBALANCE_LENGTH) }, { rank: 'a'.repeat(RANK_REBALANCE_LENGTH) + 'b' }], 1).rebalance, true)
})

test('compareRanked breaks equal ranks by creation time then id', () => {
  const items = [
    { rank: 'M', createdAt: 5, id: 'b' },
    { rank: 'M', createdAt: 5, id: 'a' },
    { rank: 'M', createdAt: 1, id: 'z' },
    { rank: 'A', createdAt: 9, id: 'q' },
  ]
  assert.deepEqual(items.sort(compareRanked).map((item) => item.id), ['q', 'z', 'a', 'b'])
})
