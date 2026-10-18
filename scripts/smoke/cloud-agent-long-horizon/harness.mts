/**
 * Long-horizon cloud-agent smoke: Claude Code (ACP) on a Boat box, on a Claude subscription, whose working
 * directory is a projection of an object-storage "drive" (R2) rather than the box's own disk.
 *
 * This process plays the Overlay control plane. It never gives the box storage credentials:
 *   1. hydrate  — copy the scope's objects from R2 into /home/user/drive on the box
 *   2. run      — start the in-box ACP driver and tail its sequenced event log by cursor
 *   3. sync     — write-through: every few seconds, and after each file-writing tool, hash the drive and
 *                 upload changed files to R2 (content-addressed check via sha256 metadata)
 *   4. verify   — list R2, compare hashes, then DELETE the box, hydrate a brand-new box from R2 and
 *                 compare hashes again (proves nothing important lived only on the sandbox)
 *
 * Usage (from overlay-landing/):
 *   Through Overlay (a PR preview or local dev server; see via-overlay.mts):
 *     npx tsx scripts/smoke/cloud-agent-long-horizon/harness.mts --via overlay --preview-url https://pr-<n>.preview.getoverlay.io
 *   Directly against a Boat box (provider baseline):
 *   npx tsx scripts/smoke/cloud-agent-long-horizon/harness.mts [--model claude-haiku-5-5] [--mode bypassPermissions]
 *     [--scope personal/smoke-user] [--box <id>] [--keep-box] [--probe] [--prompt-file path]
 * Env (from .env.local): BOX_API_KEY | BOAT_API_KEY, CLAUDE_SETUP_TOKEN, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 *   R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { Resolver } from 'node:dns/promises'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { BoxSandboxRuntime } from '../../../packages/overlay-sandbox-runtime/src/box'
import type { SandboxInstance } from '../../../packages/overlay-sandbox-runtime/src/contracts'

// Some laptops' system resolvers negative-cache hosts after a blip. Fall back to querying DNS directly.
if (process.env.SMOKE_DIRECT_DNS === '1') {
  const { Agent, setGlobalDispatcher } = await import('undici')
  const resolver = new Resolver()
  setGlobalDispatcher(new Agent({ connect: { lookup: (hostname, options, callback) => {
    resolver.resolve4(hostname).then(
      (addresses) => (options as { all?: boolean }).all
        ? callback(null, addresses.map((address) => ({ address, family: 4 })) as never, 4)
        : callback(null, addresses[0]!, 4),
      (error) => callback(error, '', 4))
  } } }))
}

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const option = (name: string, fallback?: string) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : fallback
}

// `--via overlay` runs the task through the real product on a PR preview instead of driving a box directly.
if (option('via') === 'overlay') {
  const { runViaOverlay } = await import('./via-overlay.mts')
  process.exit(await runViaOverlay(args).catch((failure) => { console.error(failure); return 1 }))
}

const HOME = '/home/user'
const DRIVE = `${HOME}/drive`
const OVERLAY = `${HOME}/.overlay-smoke`
const ACP_PREFIX = `${OVERLAY}/acp`
const imageVersions = z.object({packages: z.record(z.string())}).parse(JSON.parse(readFileSync(join(here, '../../../infra/agent-image/versions.json'), 'utf8')))
const ADAPTER_VERSION = option('adapter-version', imageVersions.packages['@agentclientprotocol/claude-agent-acp'])!
const ADAPTER_BIN = `${ACP_PREFIX}/node_modules/.bin/claude-agent-acp`
const MODEL = option('model', 'claude-haiku-5-5')!
const MODE = option('mode', 'bypassPermissions')!
const SCOPE = option('scope', 'personal/smoke-user')!
const RUN_ID = `run-${new Date().toISOString().replace(/[:.]/g, '-')}`
const RUN_DIR = `${OVERLAY}/runs/${RUN_ID}`
const PREFIX = `smoke/agent-drive/${SCOPE.replace(/\/+$/, '')}/`
const OUT = join(here, '../../../artifacts/smoke/cloud-agent-long-horizon', RUN_ID)
const SYNC_EVERY_MS = 15_000
const HARNESS_STALL_MS = 180_000
const HARD_LIMIT_MS = Number(option('hard-limit-min', '45')) * 60_000

const requireEnv = (name: string) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set`)
  return value
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${requireEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: requireEnv('R2_ACCESS_KEY_ID'), secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY') },
})
const BUCKET = requireEnv('R2_BUCKET_NAME')
const runtime = new BoxSandboxRuntime()

mkdirSync(OUT, { recursive: true })
const transcriptPath = join(OUT, 'transcript.md')
const logPath = join(OUT, 'events.ndjson')
writeFileSync(transcriptPath, '')
writeFileSync(logPath, '')
const log = (...parts: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...parts)
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function sh(box: SandboxInstance, script: string, timeoutMs = 600_000) {
  const handle = await box.runCommand({ command: 'bash', args: ['-lc', script], timeoutMs })
  const result = await handle.wait()
  if (result.exitCode !== 0) throw new Error(`box command failed (${result.exitCode}): ${script.slice(0, 120)}\n${result.stderr.slice(-2000)}`)
  return result.stdout
}

// ---------------------------------------------------------------- drive (R2) ----

async function listDrive(): Promise<Map<string, { key: string; sha?: string; size: number }>> {
  const objects = new Map<string, { key: string; sha?: string; size: number }>()
  let token: string | undefined
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token }))
    for (const object of page.Contents ?? []) {
      const path = object.Key!.slice(PREFIX.length)
      if (path.startsWith('.overlay/')) continue
      const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: object.Key! }))
      objects.set(path, { key: object.Key!, sha: head.Metadata?.sha256, size: object.Size ?? 0 })
    }
    token = page.NextContinuationToken
  } while (token)
  return objects
}

async function seedDrive() {
  const brief = readFileSync(join(here, 'BRIEF.md'))
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}BRIEF.md`, Body: brief,
    ContentType: 'text/markdown', Metadata: { sha256: sha256(brief), writer: 'harness-seed' } }))
}

async function hydrate(box: SandboxInstance) {
  const objects = await listDrive()
  await sh(box, `mkdir -p ${DRIVE}`)
  const files: Array<{ path: string; contents: Uint8Array }> = []
  for (const [path, object] of objects) {
    const body = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: object.key }))
    files.push({ path: `${DRIVE}/${path}`, contents: await body.Body!.transformToByteArray() })
  }
  const dirs = [...new Set(files.map((file) => dirname(file.path)))]
  if (dirs.length) await sh(box, `mkdir -p ${dirs.map((dir) => `'${dir}'`).join(' ')}`)
  for (let index = 0; index < files.length; index += 8) await box.writeFiles(files.slice(index, index + 8))
  return objects
}

/** Write-through sync: hash every drive file on the box and upload whatever changed. */
const synced = new Map<string, string>() // path -> sha already in R2
const syncLedger: Array<{ at: number; path: string; sha: string; bytes: number; reason: string }> = []
async function syncDrive(box: SandboxInstance, reason: string) {
  const listing = await sh(box, `cd ${DRIVE} && find . -type f -not -path './.git/*' -not -path './node_modules/*' -print0 | xargs -0 -r sha256sum`, 120_000)
  const changed: Array<{ path: string; sha: string }> = []
  for (const line of listing.split('\n').filter(Boolean)) {
    const [sha, ...rest] = line.split(/\s+/)
    const path = rest.join(' ').replace(/^\.\//, '')
    if (synced.get(path) !== sha) changed.push({ path, sha })
  }
  for (const file of changed) {
    const bytes = await box.readFile(`${DRIVE}/${file.path}`)
    if (!bytes) continue
    const actual = sha256(bytes)
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}${file.path}`, Body: bytes,
      ContentType: contentType(file.path), Metadata: { sha256: actual, writer: 'claude-code', run: RUN_ID } }))
    synced.set(file.path, actual)
    syncLedger.push({ at: Date.now(), path: file.path, sha: actual, bytes: bytes.byteLength, reason })
  }
  if (changed.length) log(`sync(${reason}): ${changed.length} file(s) → r2://${PREFIX}`, changed.map((file) => file.path).join(', '))
  return changed.length
}

function contentType(path: string) {
  if (path.endsWith('.md')) return 'text/markdown'
  if (path.endsWith('.csv')) return 'text/csv'
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.html')) return 'text/html'
  return 'application/octet-stream'
}

// ---------------------------------------------------------------- box ----

async function prepareBox(existing?: string) {
  const box = existing
    ? await runtime.reconnect(existing)
    : await runtime.create({ name: `overlay-smoke-${RUN_ID}`.slice(0, 60), persistent: true,
      networkPolicy: { mode: 'allow_all' } as never, idleTimeoutMs: 0, hardTimeoutMs: 3 * 3600_000,
      resources: { vcpus: 2, memoryGiB: 4, diskGiB: 40 } })
  log('box', box.reference)
  const installed = await sh(box, `test -x ${ADAPTER_BIN} && cat ${ACP_PREFIX}/node_modules/@agentclientprotocol/claude-agent-acp/package.json | grep '"version"' || true`)
  if (!installed.includes(ADAPTER_VERSION)) {
    log(`installing @agentclientprotocol/claude-agent-acp@${ADAPTER_VERSION}`)
    await sh(box, `mkdir -p ${ACP_PREFIX} && cd ${ACP_PREFIX} && npm init -y >/dev/null && npm i --no-audit --no-fund @agentclientprotocol/claude-agent-acp@${ADAPTER_VERSION} >/dev/null 2>&1 && ${ADAPTER_BIN} --version || true`)
  }
  return box
}

async function startDriver(box: SandboxInstance, prompt: string) {
  const token = requireEnv('CLAUDE_SETUP_TOKEN')
  await sh(box, `mkdir -p ${RUN_DIR} && chmod 700 ${OVERLAY}`)
  await box.writeFiles([
    { path: `${OVERLAY}/driver.mjs`, contents: readFileSync(join(here, 'driver.mjs')) },
    // The token goes to a 0600 file that only the driver's shell sources; it is not on any command line.
    { path: `${OVERLAY}/credentials.env`, contents: new TextEncoder().encode(`export CLAUDE_CODE_OAUTH_TOKEN='${token}'\n`) },
    { path: `${RUN_DIR}/config.json`, contents: new TextEncoder().encode(JSON.stringify({
      adapterBin: ADAPTER_BIN, cwd: DRIVE, runDir: RUN_DIR, model: MODEL, mode: MODE, prompt,
      permissionPolicy: 'allow', stallMs: 90_000,
    })) },
  ])
  await sh(box, `chmod 600 ${OVERLAY}/credentials.env && cd ${DRIVE} && (set -a; . ${OVERLAY}/credentials.env; set +a; `
    + `nohup node ${OVERLAY}/driver.mjs ${RUN_DIR}/config.json > ${RUN_DIR}/driver.log 2>&1 < /dev/null &) ; echo started`)
}

// ---------------------------------------------------------------- main ----

type DriverEvent = { seq: number; t: number; type: string; [key: string]: unknown }

async function main() {
  const startedAt = Date.now()
  const promptFile = option('prompt-file', join(here, 'PROMPT.md'))!
  const prompt = flag('probe') ? 'Reply with exactly: ready. Do not use tools.' : readFileSync(promptFile, 'utf8')
  if (!flag('probe')) await seedDrive()
  const box = await prepareBox(option('box'))
  const hydrated = await hydrate(box)
  for (const [path, object] of hydrated) if (object.sha) synced.set(path, object.sha)
  log(`hydrated ${hydrated.size} file(s) from r2://${PREFIX}`)
  await startDriver(box, prompt)

  // Tail the in-box log by cursor. A dropped poll just retries from the same cursor: nothing is lost.
  let cursor = 0
  let lastSeq = 0
  let lastGrowthAt = Date.now()
  let lastSyncAt = Date.now()
  let pollFailures = 0
  const counters = { text: 0, textChars: 0, tools: 0, toolsFailed: 0, permissions: 0, stalls: 0, heartbeats: 0, maxToolMs: 0, maxQuietMs: 0 }
  let session: DriverEvent | undefined
  let terminal: DriverEvent | undefined
  let needsSync = false
  const timeline: Array<{ t: number; type: string; label: string }> = []

  while (!terminal) {
    if (Date.now() - startedAt > HARD_LIMIT_MS) throw new Error('hard limit reached')
    await sleep(2_000)
    let bytes: Uint8Array | null
    try { bytes = await box.readFile(`${RUN_DIR}/events.ndjson`); pollFailures = 0 }
    catch (error) { pollFailures += 1; log('poll failed (retrying from cursor)', String(error)); continue }
    if (!bytes || bytes.byteLength <= cursor) {
      if (Date.now() - lastGrowthAt > HARNESS_STALL_MS) throw new Error(`no events for ${HARNESS_STALL_MS / 1000}s (driver dead?)`)
      continue
    }
    const chunk = new TextDecoder().decode(bytes.subarray(cursor))
    const complete = chunk.lastIndexOf('\n') + 1
    cursor += new TextEncoder().encode(chunk.slice(0, complete)).byteLength
    lastGrowthAt = Date.now()
    for (const line of chunk.slice(0, complete).split('\n').filter(Boolean)) {
      const event = JSON.parse(line) as DriverEvent
      if (event.seq !== lastSeq + 1) throw new Error(`event gap: expected ${lastSeq + 1}, got ${event.seq}`)
      lastSeq = event.seq
      writeFileSync(logPath, `${line}\n`, { flag: 'a' })
      switch (event.type) {
        case 'session':
          session = event
          log('session', event.sessionId, 'model', event.currentModel, 'mode', event.currentMode)
          log('  models:', (event.availableModels as Array<{ id: string }> | undefined)?.map((model) => model.id).join(', '))
          log('  modes :', (event.availableModes as Array<{ id: string }> | undefined)?.map((mode) => mode.id).join(', '))
          break
        case 'model_set': case 'mode_set': case 'initialized': case 'prompt_sent':
          log(event.type, JSON.stringify({ ...event, seq: undefined, t: undefined, type: undefined }))
          break
        case 'text':
          counters.text += 1
          counters.textChars += (event.delta as string).length
          writeFileSync(transcriptPath, event.delta as string, { flag: 'a' })
          process.stdout.write('.')
          break
        case 'tool': {
          const status = event.status as string
          if (status === 'completed' || status === 'failed') {
            counters.tools += 1
            if (status === 'failed') counters.toolsFailed += 1
            counters.maxToolMs = Math.max(counters.maxToolMs, Number(event.ms ?? 0))
            if (event.kind === 'edit' || event.kind === 'delete' || event.kind === 'move' || event.kind === 'execute' || /write|edit/i.test(String(event.title))) needsSync = true
          }
          timeline.push({ t: event.t, type: `tool:${status}`, label: String(event.title) })
          writeFileSync(transcriptPath, `\n\n> tool ${status}: ${event.title}${event.ms ? ` (${event.ms} ms)` : ''}\n\n`, { flag: 'a' })
          process.stdout.write('\n')
          log(`tool ${status.padEnd(9)} ${String(event.title).slice(0, 100)}${event.ms ? ` ${event.ms}ms` : ''}`)
          break
        }
        case 'permission':
          counters.permissions += 1
          log('permission auto-decided', event.decision, String(event.title).slice(0, 80))
          break
        case 'heartbeat':
          counters.heartbeats += 1
          counters.maxQuietMs = Math.max(counters.maxQuietMs, Number(event.quietMs))
          break
        case 'stall':
          counters.stalls += 1
          log('STALL', JSON.stringify(event.openTools))
          break
        case 'plan':
          timeline.push({ t: event.t, type: 'plan', label: `${(event.entries as unknown[]).length} entries` })
          break
        case 'done': case 'error': case 'adapter_exit':
          if (event.type !== 'adapter_exit' || !terminal) terminal = event
          process.stdout.write('\n')
          log(event.type, JSON.stringify({ ...event, seq: undefined, t: undefined }).slice(0, 600))
          break
      }
    }
    if (needsSync || Date.now() - lastSyncAt > SYNC_EVERY_MS) {
      needsSync = false
      lastSyncAt = Date.now()
      await syncDrive(box, 'checkpoint').catch((error) => log('sync deferred', String(error)))
    }
  }

  await syncDrive(box, 'final')
  const finishedAt = Date.now()

  // Verify the drive in R2 matches what the agent produced.
  const remote = await listDrive()
  const mismatches = [...synced].filter(([path, sha]) => remote.get(path)?.sha !== sha)
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}.overlay/runs/${RUN_ID}.json`, ContentType: 'application/json',
    Body: JSON.stringify({ runId: RUN_ID, files: Object.fromEntries(synced), ledger: syncLedger }, null, 2) }))

  // Persistence proof: throw the machine away and rebuild the drive on a fresh one.
  let rehydrate: { box: string; files: number; mismatches: string[] } | undefined
  if (!flag('probe') && !flag('skip-rehydrate')) {
    if (!flag('keep-box')) { await box.delete(); log('deleted box', box.reference) }
    const fresh = await runtime.create({ name: `overlay-smoke-rehydrate-${RUN_ID}`.slice(0, 60), persistent: false,
      networkPolicy: { mode: 'allow_all' } as never, idleTimeoutMs: 0, hardTimeoutMs: 1800_000,
      resources: { vcpus: 2, memoryGiB: 4, diskGiB: 40 } })
    await hydrate(fresh)
    const listing = await sh(fresh, `cd ${DRIVE} && find . -type f -print0 | xargs -0 -r sha256sum`)
    const freshShas = new Map(listing.split('\n').filter(Boolean).map((line) => {
      const [sha, ...rest] = line.split(/\s+/)
      return [rest.join(' ').replace(/^\.\//, ''), sha] as const
    }))
    const bad = [...synced].filter(([path, sha]) => freshShas.get(path) !== sha).map(([path]) => path)
    rehydrate = { box: fresh.reference, files: freshShas.size, mismatches: bad }
    log(`rehydrated fresh box ${fresh.reference}: ${freshShas.size} files, ${bad.length} mismatches`)
    await fresh.delete()
  }

  const report = {
    runId: RUN_ID,
    box: box.reference,
    adapter: `@agentclientprotocol/claude-agent-acp@${ADAPTER_VERSION}`,
    requested: { model: MODEL, mode: MODE },
    agentModels: (session?.availableModels as unknown[] | undefined) ?? [],
    agentModes: (session?.availableModes as unknown[] | undefined) ?? [],
    outcome: terminal.type === 'done' ? `completed (${terminal.stopReason})` : `${terminal.type}: ${String(terminal.message ?? '')}`,
    durationSeconds: Math.round((finishedAt - startedAt) / 1000),
    counters,
    pollFailures,
    drive: { prefix: `r2://${BUCKET}/${PREFIX}`, files: [...synced].map(([path, sha]) => ({ path, sha, bytes: remote.get(path)?.size })),
      uploads: syncLedger.length, mismatches: mismatches.map(([path]) => path) },
    rehydrate,
    timeline,
  }
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  log('report →', join(OUT, 'report.json'))
  console.log(JSON.stringify({ ...report, timeline: undefined, agentModels: report.agentModels.length }, null, 2))
  if (flag('probe')) {
    for (const path of synced.keys()) if (!hydrated.has(path)) await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}${path}` }))
  }
  const ok = terminal.type === 'done' && mismatches.length === 0 && (!rehydrate || rehydrate.mismatches.length === 0)
  process.exit(ok ? 0 : 1)
}

main().catch((error) => { console.error(error); process.exit(1) })
