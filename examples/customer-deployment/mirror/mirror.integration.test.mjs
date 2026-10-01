// Integration test: spawns the real mirror process against a mock
// /api/v1/data/sync endpoint + real Postgres (MIRROR_TEST_DATABASE_URL
// required — the suite skips cleanly without it).
// The mock emits the REAL wire format observed on a live backend:
//   {status:{type}, truncates:[{component,table}],
//    values:[{component,table,ts,deleted,value}], syncId,
//    pagination:{hasMore:true, nextCursor:"opaque"}}
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DB_URL = process.env.MIRROR_TEST_DATABASE_URL
const MIRROR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mirror.mjs')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// state.pages: queue of raw {values, truncates, status} page descriptors to
// serve in order; afterwards every poll returns upToDate with no changes.
function startMockBackend(state) {
  return http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      JSON.parse(body || '{}')
      const send = (text) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(text) // already-serialized raw JSON — preserves i64 digits
      }
      if (req.url === '/api/v1/data/sync') {
        const page = state.pages.length ? state.pages.shift() : { values: [], truncates: [], status: 'upToDate' }
        // values may be pre-serialized raw JSON strings so 19-digit ts values
        // are emitted verbatim (JSON.stringify of a JS number would round).
        const vals = (page.values || []).map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(',')
        send(`{"status":{"type":"${page.status}"},"truncates":${JSON.stringify(page.truncates || [])},"values":[${vals}],"syncId":"test-sync-1","pagination":{"hasMore":true,"nextCursor":"cursor-${++state.seq}"}}`)
        return
      }
      res.writeHead(404).end()
    })
  })
}

async function runMirror(env, until, timeoutMs = 15000) {
  const child = spawn('node', [MIRROR], { env: { ...process.env, ...env } })
  let out = ''
  child.stdout.on('data', (d) => (out += d))
  child.stderr.on('data', (d) => (out += d))
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (until(out)) {
      child.kill('SIGTERM')
      await sleep(300)
      return out
    }
    await sleep(100)
  }
  child.kill('SIGKILL')
  throw new Error(`mirror did not reach condition; log:\n${out}`)
}

async function query(dbUrl, sql, params) {
  const { default: pg } = await import('pg')
  const c = new pg.Client({ connectionString: dbUrl })
  await c.connect()
  try {
    return (await c.query(sql, params)).rows
  } finally {
    await c.end()
  }
}

test('sync: snapshot + deltas + truncates + tombstones + resume', { skip: !DB_URL }, async () => {
  const state = {
    seq: 0,
    pages: [
      // Page 1: initial snapshot rows across two tables (i64 ts as raw digits
      // via pre-serialized value strings? no — values are objects; ts 19-digit
      // is emitted by hand below via raw JSON page mode).
      // Page 1: initial snapshot rows (raw strings — verbatim i64 ts digits).
      {
        status: 'snapshotting',
        truncates: [{ component: '', table: 'users' }],
        values: [
          '{"component":"","table":"users","ts":1789794430743749172,"deleted":false,"value":{"_id":"u1","_creationTime":1789794430743.164,"name":"ada"}}',
          '{"component":"","table":"threads","ts":1789794431743749173,"deleted":false,"value":{"_id":"t1","_creationTime":1789794431743.0,"title":"hi"}}',
        ],
      },
      // Page 2: update u1, component-scoped insert, tombstone t1.
      {
        status: 'stale',
        values: [
          '{"component":"","table":"users","ts":1789794532324853760,"deleted":false,"value":{"_id":"u1","_creationTime":1789794430743.164,"name":"ada2"}}',
          '{"component":"agent","table":"runs","ts":1789794532324853761,"deleted":false,"value":{"_id":"r1","_creationTime":1789794532325.0}}',
          '{"component":"","table":"threads","ts":1789794532324853762,"deleted":true,"value":{"_id":"t1"}}',
        ],
      },
      { status: 'upToDate' },
    ],
  }
  const server = startMockBackend(state).listen(0)
  const port = server.address().port
  const schema = `mirror_it_${Date.now()}`
  const env = {
    CONVEX_URL: `http://127.0.0.1:${port}`,
    CONVEX_ADMIN_KEY: 'test-key',
    MIRROR_DATABASE_URL: DB_URL,
    MIRROR_SCHEMA: schema,
    MIRROR_POLL_MS: '150',
  }

  try {
    const log1 = await runMirror(env, (o) => o.includes('caught up'))
    const users = await query(DB_URL, `SELECT id, doc->>'name' AS name, ts::text AS ts FROM "${schema}"."users"`)
    assert.deepEqual(users, [{ id: 'u1', name: 'ada2', ts: '1789794532324853760' }])
    assert.deepEqual(await query(DB_URL, `SELECT id FROM "${schema}"."threads"`), []) // tombstoned
    assert.deepEqual(await query(DB_URL, `SELECT id FROM "${schema}"."agent_runs"`), [{ id: 'r1' }])
    const meta = await query(DB_URL, `SELECT v::text AS v FROM "${schema}"._meta WHERE k='sync_cursor'`)
    assert.equal(meta[0].v, `"cursor-${state.seq}"`)

    // Push a bulk truncate + a fresh insert; mirror should apply both.
    state.pages.push({
      status: 'stale',
      truncates: [{ component: '', table: 'users' }],
      values: [
        '{"component":"","table":"users","ts":1789794533324853760,"deleted":false,"value":{"_id":"u9","_creationTime":1789794533324.0,"name":"grace"}}',
      ],
    })
    // Restart the mirror — it resumes from the persisted cursor and drains
    // the truncate+insert page.
    const log2 = await runMirror(env, (o) => o.includes('resuming') && o.includes('caught up'), 15000)
    assert.ok(log2.includes('resuming from stored cursor')) // no re-snapshot
    const users2 = await query(DB_URL, `SELECT id, doc->>'name' AS name FROM "${schema}"."users"`)
    assert.deepEqual(users2, [{ id: 'u9', name: 'grace' }]) // truncate + insert
    assert.ok(!log1.includes('fatal') && !log2.includes('fatal'))
  } finally {
    server.close()
    const { default: pg } = await import('pg')
    const c = new pg.Client({ connectionString: DB_URL })
    await c.connect()
    await c.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await c.end()
  }
})
