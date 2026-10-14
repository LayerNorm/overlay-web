import assert from 'node:assert/strict'
import test from 'node:test'
import { parseShard, selectShard, verifyShards } from './test-shards.mjs'

const groups = [
  ['tsx', { kind: 'tsx', files: ['a', 'b', 'c', 'd', 'e'] }],
  ['package:host', { kind: 'npm-test', files: ['host/a', 'host/b'] }],
]
test('shards are complete and disjoint, with atomic package scripts', () => {
  assert.equal(verifyShards(groups, 2), 7)
  const first = selectShard(groups, parseShard('1/2'))
  const second = selectShard(groups, parseShard('2/2'))
  assert.deepEqual(first[0][1].files, ['a', 'c', 'e'])
  assert.deepEqual(second[0][1].files, ['b', 'd'])
  assert.equal(first.some(([name]) => name === 'package:host'), false)
  assert.deepEqual(second[1][1].files, ['host/a', 'host/b'])
})
test('invalid, empty and duplicated inventories fail instead of passing zero tests', () => {
  for (const value of ['', '0/2', '3/2', '1/0', '1/1.5', '1/Infinity', '1/9007199254740992']) assert.throws(() => parseShard(value))
  assert.throws(() => verifyShards([], 2), /Empty/)
  assert.throws(() => verifyShards([['tsx', { kind: 'tsx', files: ['a', 'a'] }]], 2), /duplicate/)
  assert.throws(() => verifyShards(groups, 10), /empty/)
})
