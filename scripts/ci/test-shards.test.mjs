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
  const packageShards = [first, second].filter(shard => shard.some(([name]) => name === 'package:host'))
  assert.equal(packageShards.length, 1)
  assert.deepEqual(packageShards[0].find(([name]) => name === 'package:host')[1].files, ['host/a', 'host/b'])
  assert.ok(Math.abs(first.flatMap(([, group]) => group.files).length - second.flatMap(([, group]) => group.files).length) <= 1)
})

test('expensive atomic package work receives fewer ordinary files without dropping tests', () => {
  const inventory = [
    ['tsx', { kind: 'tsx', files: Array.from({ length: 300 }, (_, i) => `file-${i}`) }],
    ['package:overlay-agent-host', { kind: 'npm-test', files: ['host/a', 'host/b'] }],
  ]
  assert.equal(verifyShards(inventory, 2), 302)
  const shards = [1, 2].map(index => selectShard(inventory, { index, total: 2 }))
  const host = shards.find(shard => shard.some(([name]) => name === 'package:overlay-agent-host'))
  const other = shards.find(shard => shard !== host)
  assert.ok(host[0][1].files.length < other[0][1].files.length)
  assert.deepEqual(selectShard(inventory, { index: 1, total: 2 }), shards[0], 'assignment is deterministic')
})
test('invalid, empty and duplicated inventories fail instead of passing zero tests', () => {
  for (const value of ['', '0/2', '3/2', '1/0', '1/1.5', '1/Infinity', '1/9007199254740992']) assert.throws(() => parseShard(value))
  assert.throws(() => verifyShards([], 2), /Empty/)
  assert.throws(() => verifyShards([['tsx', { kind: 'tsx', files: ['a', 'a'] }]], 2), /duplicate/)
  assert.throws(() => verifyShards(groups, 10), /empty/)
})
