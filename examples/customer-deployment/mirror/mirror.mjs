#!/usr/bin/env node
// Overlay read mirror — replicates a self-hosted Convex deployment into
// normalized Postgres tables for BI / data-lake consumption.
//
// Pipeline: POST {CONVEX_URL}/api/v1/data/sync — the supported Data Sync
// endpoint. One infinite stream: initial snapshot pages, then deltas.
//   - `values` carry upserts and tombstones (`deleted: true`, value has _id)
//   - `truncates` mark tables whose contents were bulk-replaced -> TRUNCATE
//   - the durable opaque cursor lives in {MIRROR_SCHEMA}._meta, so restarts
//     resume exactly where they stopped (syncId resets; cursor is enough)
//
// Writes land in {MIRROR_SCHEMA}.<table> — one mirror table per Convex table,
// component-scoped names prefixed. Only supported Convex export APIs are
// used — this never touches the backend's internal persistence tables.

import pg from 'pg'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function configFromEnv(env = process.env) {
  const convexUrl = (env.CONVEX_URL || env.CONVEX_SELF_HOSTED_URL || '').replace(/\/+$/, '')
  const adminKey = env.CONVEX_ADMIN_KEY || env.CONVEX_SELF_HOSTED_ADMIN_KEY || ''
  return {
    convexUrl,
    adminKey,
    databaseUrl: env.MIRROR_DATABASE_URL || '',
    adminDatabaseUrl: env.MIRROR_ADMIN_URL || '',
    schema: env.MIRROR_SCHEMA || 'mirror',
    pollMs: parseInt(env.MIRROR_POLL_MS || '2000', 10),
    retryBaseMs: parseInt(env.MIRROR_RETRY_BASE_MS || '1000', 10),
    retryMaxMs: parseInt(env.MIRROR_RETRY_MAX_MS || '30000', 10),
    tableAllowlist: parseCsv(env.MIRROR_TABLES),
  }
}

export function parseCsv(value) {
  if (!value) return null
  const items = value.split(',').map((s) => s.trim()).filter(Boolean)
  return items.length ? new Set(items) : null
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

// Postgres identifiers: lowercase, <= 63 bytes. Convex table names are
// already valid-ish; sanitize defensively and keep it deterministic.
export function sanitizeIdent(name) {
  let out = name.toLowerCase().replace(/[^a-z0-9_]/g, '_')
  if (/^[0-9]/.test(out)) out = '_' + out
  if (out.length > 60) {
    // Truncate + short hash suffix so distinct long names don't collide.
    let h = 0
    for (let i = 0; i < out.length; i++) h = (h * 31 + out.charCodeAt(i)) >>> 0
    out = out.slice(0, 52) + '_' + h.toString(36)
  }
  return out
}

// Mirror table name for a Convex (component, table) pair. Application-space
// docs arrive with component "" / "app" / null — those get the bare table
// name; component tables get "<component>_<table>".
export function tableNameFor(component, table) {
  const t = sanitizeIdent(table)
  if (!component || component === 'app') return t
  return sanitizeIdent(component) + '_' + t
}

// DataSync values:
//   {"component":"","table":"users","ts":1789…,"deleted":false,
//    "value":{"_id":"…","_creationTime":1789…., <document fields…>}}
// `value` is the whole document; tombstones carry only `_id`.
export function rowFor(entry) {
  if (!entry || typeof entry !== 'object') return null
  const value = entry.value
  if (!value || typeof value !== 'object') return null
  const id = value._id
  if (typeof id !== 'string' || !id) return null
  return {
    table: tableNameFor(entry.component, entry.table),
    id,
    ts: entry.ts == null ? '0' : String(entry.ts),
    creationTime: typeof value._creationTime === 'number' ? value._creationTime : null,
    deleted: entry.deleted === true,
    doc: value,
  }
}

// Convex export timestamps are nanosecond-scale i64s (~1.8e18) — beyond
// Number.MAX_SAFE_INTEGER. Quote every bare integer with 16+ digits before
// JSON.parse so `ts` values stay lossless (stored as bigint in Postgres).
// Side effect: genuine user int64 fields >= 1e16 become strings inside `doc`.
export function parseExportResponse(text) {
  return JSON.parse(text.replace(/:(\s*)(-?\d{16,})/g, ':"$2"'))
}

// POST body for /api/v1/data/sync. `selection: {"_other":"included"}` selects
// every component/table/column. `syncId` + `cursor` are opaque strings —
// pass null for both on first sync; pass cursor (with syncId null) to resume.
export function syncBody(syncId, cursor) {
  return `{"syncId":${syncId == null ? 'null' : JSON.stringify(syncId)},"cursor":${cursor == null ? 'null' : JSON.stringify(cursor)},"selection":{"_other":"included"}}`
}

// Quote a schema-qualified identifier pair.
export function qi(schema, table) {
  return `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`
}

// ---------------------------------------------------------------------------
// Convex export client
// ---------------------------------------------------------------------------

async function exportCall(cfg, path, body) {
  const res = await fetch(`${cfg.convexUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Convex ${cfg.adminKey}`,
    },
    body, // pre-serialized — opaque strings need exact JSON quoting
    signal: AbortSignal.timeout(60_000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${text.slice(0, 400)}`)
  return parseExportResponse(text)
}

// ---------------------------------------------------------------------------
// Postgres writer
// ---------------------------------------------------------------------------

const TABLE_DDL = `(
  id text PRIMARY KEY,
  creation_time timestamptz,
  ts bigint NOT NULL,
  doc jsonb NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
)`

const META_DDL = `(k text PRIMARY KEY, v jsonb NOT NULL)`

async function ensureSchema(client, schema) {
  const s = schema.replace(/"/g, '""')
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${s}"`)
  await client.query(`CREATE TABLE IF NOT EXISTS ${qi(schema, '_meta')} ${META_DDL}`)
}

const ensuredTables = new Set()

async function ensureTable(client, schema, table) {
  if (ensuredTables.has(table)) return
  await client.query(`CREATE TABLE IF NOT EXISTS ${qi(schema, table)} ${TABLE_DDL}`)
  ensuredTables.add(table)
}

async function applyRows(client, cfg, rows) {
  for (const row of rows) {
    if (cfg.tableAllowlist && !cfg.tableAllowlist.has(row.table)) continue
    await ensureTable(client, cfg.schema, row.table)
    const t = qi(cfg.schema, row.table)
    if (row.deleted) {
      await client.query(`DELETE FROM ${t} WHERE id = $1`, [row.id])
    } else {
      await client.query(
        `INSERT INTO ${t} (id, creation_time, ts, doc)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE
           SET ts = EXCLUDED.ts, doc = EXCLUDED.doc, synced_at = now()
           WHERE ${t}.ts <= EXCLUDED.ts`,
        [row.id, row.creationTime == null ? null : new Date(row.creationTime), row.ts, row.doc],
      )
    }
  }
}

async function getMeta(client, schema, key) {
  const { rows } = await client.query(`SELECT v FROM ${qi(schema, '_meta')} WHERE k = $1`, [key])
  return rows[0]?.v ?? null
}

async function setMeta(client, schema, key, value) {
  await client.query(
    `INSERT INTO ${qi(schema, '_meta')} (k, v) VALUES ($1, $2)
     ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`,
    [key, JSON.stringify(value)],
  )
}

// ---------------------------------------------------------------------------
// Sync pipeline
// ---------------------------------------------------------------------------

function log(...args) {
  console.log(new Date().toISOString(), '[mirror]', ...args)
}

// One /api/v1/data/sync page: apply truncations + upserts/deletes + advance
// the durable cursor in a single transaction. A crash mid-page replays the
// whole page safely (upserts + truncates are idempotent).
async function syncOnce(pool, cfg, session) {
  const res = await exportCall(cfg, '/api/v1/data/sync', syncBody(session.syncId, session.cursor))
  if (res.syncId) session.syncId = res.syncId
  const rows = (res.values || []).map(rowFor).filter(Boolean)
  const truncs = res.truncates || []
  const nextCursor = res.pagination?.nextCursor ?? session.cursor

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const t of truncs) {
      const table = tableNameFor(t.component, t.table)
      if (cfg.tableAllowlist && !cfg.tableAllowlist.has(table)) continue
      await ensureTable(client, cfg.schema, table)
      await client.query(`TRUNCATE ${qi(cfg.schema, table)}`)
    }
    await applyRows(client, cfg, rows)
    await setMeta(client, cfg.schema, 'sync_cursor', nextCursor)
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }

  session.cursor = nextCursor
  return { applied: rows.length, truncated: truncs.length, status: res.status?.type }
}

async function ensureDatabase(cfg) {
  if (!cfg.adminDatabaseUrl) return // assume MIRROR_DATABASE_URL already exists
  const target = new URL(cfg.databaseUrl).pathname.replace(/^\//, '')
  if (!target) return
  const admin = new pg.Client({ connectionString: cfg.adminDatabaseUrl })
  await admin.connect()
  try {
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [target])
    if (!rows.length) {
      await admin.query(`CREATE DATABASE "${target.replace(/"/g, '""')}"`)
      log(`created database ${target}`)
    }
  } finally {
    await admin.end()
  }
}

async function main() {
  const cfg = configFromEnv()
  for (const [k, v] of [['CONVEX_URL', cfg.convexUrl], ['CONVEX_ADMIN_KEY', cfg.adminKey], ['MIRROR_DATABASE_URL', cfg.databaseUrl]]) {
    if (!v) {
      console.error(`[mirror] missing required env: ${k}`)
      process.exit(2)
    }
  }

  await ensureDatabase(cfg)
  const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 4 })

  let stopping = false
  const stop = () => { stopping = true }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  {
    const client = await pool.connect()
    try { await ensureSchema(client, cfg.schema) } finally { client.release() }
  }

  // Resume from the durable cursor (or start a fresh snapshot when absent).
  const stored = await getMeta(pool, cfg.schema, 'sync_cursor')
  const session = { syncId: null, cursor: stored ?? null }
  log(stored ? `resuming from stored cursor` : 'starting initial sync')

  let delay = cfg.retryBaseMs
  let loggedCatchUp = false
  while (!stopping) {
    try {
      const { applied, truncated, status } = await syncOnce(pool, cfg, session)
      delay = cfg.retryBaseMs
      if (status === 'upToDate') {
        if (!loggedCatchUp) {
          log(`caught up (cursor=${String(session.cursor).slice(0, 24)}…)`)
          loggedCatchUp = true
        }
        await new Promise((r) => setTimeout(r, cfg.pollMs))
      } else {
        if (applied || truncated) log(`status=${status} applied=${applied} truncates=${truncated}`)
        loggedCatchUp = false
      }
    } catch (e) {
      log(`sync error: ${e.message} — retrying in ${delay}ms`)
      await new Promise((r) => setTimeout(r, delay))
      delay = Math.min(delay * 2, cfg.retryMaxMs)
      // A stale sync session is dropped; the persisted cursor still resumes.
      session.syncId = null
    }
  }

  await pool.end()
  log('stopped')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('[mirror] fatal:', e)
    process.exit(1)
  })
}
