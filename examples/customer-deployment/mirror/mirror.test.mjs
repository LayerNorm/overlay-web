import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  configFromEnv,
  parseCsv,
  parseExportResponse,
  qi,
  rowFor,
  sanitizeIdent,
  syncBody,
  tableNameFor,
} from './mirror.mjs'

test('sanitizeIdent lowercases and replaces invalid chars', () => {
  assert.equal(sanitizeIdent('Users'), 'users')
  assert.equal(sanitizeIdent('my-table.name'), 'my_table_name')
  assert.equal(sanitizeIdent('9lives'), '_9lives')
  assert.equal(sanitizeIdent('a$b@c'), 'a_b_c')
})

test('sanitizeIdent truncates over-length names deterministically', () => {
  const long = 't'.repeat(80)
  const a = sanitizeIdent(long)
  assert.equal(a, sanitizeIdent(long))
  assert.ok(a.length <= 63)
  assert.notEqual(a, sanitizeIdent('u'.repeat(80)))
})

test('tableNameFor prefixes component tables only', () => {
  assert.equal(tableNameFor('', 'users'), 'users')
  assert.equal(tableNameFor(null, 'users'), 'users')
  assert.equal(tableNameFor('app', 'users'), 'users')
  assert.equal(tableNameFor('agent', 'runs'), 'agent_runs')
})

test('rowFor maps DataSync values to rows', () => {
  const row = rowFor({
    component: '',
    table: 'users',
    ts: '1789794430743749172',
    deleted: false,
    value: { _id: 'u1', _creationTime: 1789794430743.164, name: 'ada', score: 42 },
  })
  assert.equal(row.table, 'users')
  assert.equal(row.id, 'u1')
  assert.equal(row.ts, '1789794430743749172')
  assert.equal(row.creationTime, 1789794430743.164)
  assert.equal(row.deleted, false)
  assert.deepEqual(row.doc, { _id: 'u1', _creationTime: 1789794430743.164, name: 'ada', score: 42 })
})

test('rowFor marks tombstones and skips malformed entries', () => {
  const tomb = rowFor({ component: '', table: 'users', ts: '5', deleted: true, value: { _id: 'u1' } })
  assert.equal(tomb.deleted, true)
  assert.equal(tomb.id, 'u1')

  assert.equal(rowFor({ component: '', table: 'users', ts: '5', deleted: false, value: {} }), null)
  assert.equal(rowFor({ component: '', table: 'users', ts: '5', value: null }), null)
  assert.equal(rowFor(null), null)
})

test('parseExportResponse preserves i64 digits beyond 2^53', () => {
  const text = '{"values":[{"ts":1789794532324853760,"deleted":false,"value":{"_id":"x","score":44.0}}],"status":{"type":"upToDate","snapshotTs":1789794873008357918},"pagination":{"hasMore":true,"nextCursor":"abc123"}}'
  const r = parseExportResponse(text)
  assert.equal(r.values[0].ts, '1789794532324853760') // digits preserved as string
  assert.equal(r.status.snapshotTs, '1789794873008357918')
  assert.equal(r.values[0].value.score, 44) // normal floats untouched
  assert.equal(r.pagination.nextCursor, 'abc123') // strings untouched
})

test('syncBody selects everything and quotes opaque strings', () => {
  assert.equal(
    syncBody(null, null),
    '{"syncId":null,"cursor":null,"selection":{"_other":"included"}}',
  )
  assert.equal(
    syncBody('b9006b85-1ffc', 'opaque0122'),
    '{"syncId":"b9006b85-1ffc","cursor":"opaque0122","selection":{"_other":"included"}}',
  )
})

test('qi quotes schema-qualified identifiers', () => {
  assert.equal(qi('mirror', 'users'), '"mirror"."users"')
  assert.equal(qi('we"ird', 't'), '"we""ird"."t"')
})

test('parseCsv builds allowlist sets', () => {
  assert.equal(parseCsv(''), null)
  assert.equal(parseCsv(undefined), null)
  assert.deepEqual([...parseCsv('a, b ,c')], ['a', 'b', 'c'])
})

test('configFromEnv accepts bootstrap-generated names', () => {
  const cfg = configFromEnv({
    CONVEX_SELF_HOSTED_URL: 'http://backend:3210/',
    CONVEX_SELF_HOSTED_ADMIN_KEY: 'convex-self-hosted|abc',
    MIRROR_DATABASE_URL: 'postgres://x/db',
  })
  assert.equal(cfg.convexUrl, 'http://backend:3210')
  assert.equal(cfg.adminKey, 'convex-self-hosted|abc')
  assert.equal(cfg.schema, 'mirror')
  assert.equal(cfg.pollMs, 2000)
})
