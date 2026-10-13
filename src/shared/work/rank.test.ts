import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankBetween, rebalanceRanks, isRank } from './rank'

test('inserts at the beginning, middle, and end preserve lexical order', () => {
  const first = rankBetween()
  const before = rankBetween(undefined, first)
  const after = rankBetween(first)
  assert.ok(before < first && first < after)
  const middle = rankBetween(first, after)
  assert.ok(first < middle && middle < after)
  assert.throws(() => rankBetween(first, first))
  assert.throws(() => rankBetween(after, first))
  assert.throws(() => rankBetween('a0'))
})
test('repeated tight insertions exhaust safely and rebalancing restores space', () => {
  let right = rankBetween()
  assert.throws(() => {
    for (let i = 0; i < 500; i++) right = rankBetween(undefined, right)
  }, /rebalance/)
  const ranks = rebalanceRanks(1000)
  assert.ok(ranks.every(isRank))
  assert.deepEqual(ranks, [...ranks].sort())
  for (let i = 1; i < ranks.length; i++) {
    const middle = rankBetween(ranks[i - 1], ranks[i])
    assert.ok(ranks[i - 1] < middle && middle < ranks[i])
  }
})
