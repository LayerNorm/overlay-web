import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { watch } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROVIDERS = Object.freeze({
  codex: { domains: ['auth.openai.com'], protocol: 'responses' },
  xai: { domains: ['accounts.x.ai'], protocol: 'chat' },
  meta: { domains: ['auth.meta.com'], protocol: 'chat' },
  kimi: { domains: ['auth.kimi.com'], protocol: 'chat' },
  'kimi-ai': { domains: ['auth.kimi.ai'], protocol: 'chat' },
  devin: { domains: ['app.devin.ai'], protocol: 'chat' },
})

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const MAX_BODY_BYTES = 2_000_000
const MAX_WORKERS = Math.min(128, Math.max(1, Number(process.env.OVERLAY_SUBSCRIPTION_MAX_WORKERS) || 128))
const SNAPSHOT_VERSION = 1
const locks = new Map()
const workers = new Map()
let singletonLock = null
let reaper = null
let clock = () => Date.now()
const now = () => clock()

function keyFor(ownerId, connectionId) {
  return createHash('sha256').update(`${ownerId}\0${connectionId}`).digest('hex')
}

function knownProvider(providerId) {
  return Object.hasOwn(PROVIDERS, providerId)
}

function configuredProviders(envName) {
  const configured = (process.env[envName] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return new Set(configured.filter(knownProvider))
}

function providerEnabled(providerId) {
  return configuredProviders('OVERLAY_SUBSCRIPTION_BROKER_ENABLED_PROVIDERS').has(providerId)
}

function assertEnabledProvider(providerId) {
  if (!knownProvider(providerId) || !providerEnabled(providerId)) {
    throw subscriptionError(400, 'This subscription provider is not enabled in this deployment')
  }
}

function validOwnerId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
}

function validConnectionId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
}

function constantTimeSecret(expected, supplied) {
  if (typeof supplied !== 'string') return false
  const left = Buffer.from(expected)
  const right = Buffer.from(supplied)
  return left.length === right.length && timingSafeEqual(left, right)
}

function sanitizedError(error) {
  const text = String(error?.message ?? '').toLowerCase()
  if (text.includes('expired') || text.includes('timeout')) return 'Authorization expired. Start again.'
  if (text.includes('unauthorized') || text.includes('invalid_grant')) return 'Authorization was rejected. Reconnect the account.'
  return 'The subscription service could not complete this request. Try again.'
}

function subscriptionError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

export function assertSupportedSubscriptionRequest(body) {
  if (body.zero_data_retention === true || body.zeroDataRetention === true || body.zdr === true) {
    throw subscriptionError(400, 'This subscription service does not guarantee zero data retention')
  }
  const inspect = (value) => {
    if (Array.isArray(value)) {
      value.forEach(inspect)
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [key, nested] of Object.entries(value)) {
      if (['image_url', 'input_image', 'input_audio', 'audio_url', 'video_url', 'input_file'].includes(key)) {
        throw subscriptionError(400, 'This subscription service supports text-only requests')
      }
      if (key === 'modalities' && Array.isArray(nested) &&
          nested.some((modality) => modality !== 'text')) {
        throw subscriptionError(400, 'This subscription service supports text-only requests')
      }
      if (key === 'type' && typeof nested === 'string' &&
          /^(?:input_image|image|audio|input_audio|output_audio|video|input_video|file|input_file|computer|browser|file_search)$/.test(nested)) {
        throw subscriptionError(400, 'This subscription service supports text-only requests')
      }
      inspect(nested)
    }
  }
  inspect(body)
}

function assertOverlayTools(body) {
  if (!Array.isArray(body.tools)) return
  for (const tool of body.tools) {
    if (!tool || typeof tool !== 'object' || !['function', 'custom'].includes(tool.type)) {
      throw subscriptionError(400, 'This subscription service does not support hosted provider tools')
    }
    if (tool.type === 'function' && (!tool.function || typeof tool.function !== 'object')) {
      throw subscriptionError(400, 'Invalid function tool')
    }
    if (tool.type === 'custom' && (typeof tool.name !== 'string' || tool.name.length > 128)) {
      throw subscriptionError(400, 'Invalid custom text tool')
    }
  }
  if (typeof body.tool_choice === 'string' &&
      !['auto', 'none', 'required'].includes(body.tool_choice)) {
    throw subscriptionError(400, 'This subscription service does not support hosted provider tools')
  }
  const choice = body.tool_choice
  if (choice && typeof choice === 'object' &&
      (!['function', 'custom'].includes(choice.type) ||
       (choice.type === 'function' &&
        typeof choice.name !== 'string' && typeof choice.function?.name !== 'string') ||
       (choice.type === 'custom' && typeof choice.name !== 'string'))) {
    throw subscriptionError(400, 'This subscription service does not support hosted provider tools')
  }
}

function serializeError(error) {
  return {
    status: Number.isInteger(error?.status) ? error.status : 500,
    body: { error: sanitizedError(error), category: 'subscription_unavailable' },
  }
}

async function withLock(key, operation) {
  const previous = locks.get(key) ?? Promise.resolve()
  let release
  const next = new Promise((resolve) => { release = resolve })
  const current = previous.then(() => next)
  locks.set(key, current)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (locks.get(key) === current) locks.delete(key)
  }
}

function masterKey() {
  const value = process.env.OVERLAY_SUBSCRIPTION_MASTER_KEY ?? ''
  const key = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64')
  if (key.length !== 32) throw new Error('OVERLAY_SUBSCRIPTION_MASTER_KEY must encode 32 bytes')
  return key
}

function encrypt(value, aad) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv)
  cipher.setAAD(Buffer.from(aad))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()])
  return JSON.stringify({
    version: SNAPSHOT_VERSION,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  })
}

function decrypt(serialized, aad) {
  const envelope = JSON.parse(serialized)
  if (envelope.version !== SNAPSHOT_VERSION) throw new Error('Invalid encrypted snapshot')
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(envelope.iv, 'base64'))
  decipher.setAAD(Buffer.from(aad))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString())
}

function runtimeRoot() {
  return process.env.OVERLAY_SUBSCRIPTION_RUNTIME_DIR ?? '/run/overlay-subscription-broker'
}

function stateRoot() {
  return process.env.OVERLAY_SUBSCRIPTION_STATE_DIR ?? '/var/lib/overlay-subscription-broker'
}

function snapshotPath(identity) {
  return path.join(stateRoot(), `${identity}.enc`)
}

const RECORD_FIELDS = new Set([
  'ownerId', 'connectionId', 'providerId', 'status', 'apiKey', 'managementKey',
  'enabledModelIds', 'discoveredModels', 'authFiles', 'oauthState', 'authExpiresAt',
  'codexDeviceCode', 'authorizationGeneration', 'codexPollLease', 'createdAt',
])
const SNAPSHOT_FILE = /^[a-f0-9]{64}\.enc$/
const SNAPSHOT_TEMP_FILE = /^[a-f0-9]{64}\.enc\.[a-f0-9]{16}\.tmp$/
const SNAPSHOT_BACKUP_FILE = /^[a-f0-9]{64}\.enc\.bak$/
const MAX_SNAPSHOT_BYTES = 3_000_000

async function acquireSingletonLock() {
  await mkdir(stateRoot(), { recursive: true, mode: 0o700 })
  const lockPath = path.join(stateRoot(), '.broker.lock')
  try {
    singletonLock = await open(lockPath, 'wx', 0o600)
    await singletonLock.writeFile(JSON.stringify({ pid: process.pid, startedAt: now() }))
    await singletonLock.sync()
  } catch (error) {
    if (singletonLock) await singletonLock.close().catch(() => {})
    singletonLock = null
    if (error?.code === 'EEXIST') {
      throw new Error('Another subscription broker owns the durable state volume')
    }
    throw error
  }
}

async function releaseSingletonLock() {
  const handle = singletonLock
  singletonLock = null
  if (!handle) return
  const lockPath = path.join(stateRoot(), '.broker.lock')
  await handle.close()
  await rm(lockPath, { force: true })
}

async function reapExpiredState() {
  const timestamp = now()
  for (const worker of [...workers.values()]) {
    if ((worker.status === 'pending' || worker.status === 'error') &&
        ((worker.authExpiresAt && worker.authExpiresAt <= timestamp) ||
         (worker.codexDeviceCode?.expiresAt && worker.codexDeviceCode.expiresAt <= timestamp))) {
      await withLock(worker.identity, async () => {
        if (workers.get(worker.identity) === worker) await stopWorker(worker)
      }).catch(() => {})
    }
  }
  let files = []
  try { files = await readdir(stateRoot()) } catch { return }
  for (const file of files) {
    if (!file.endsWith('.enc')) continue
    const identity = file.slice(0, -4)
    if (workers.has(identity)) continue
    try {
      const record = decrypt(await readFile(path.join(stateRoot(), file), 'utf8'), `overlay-subscription:${identity}`)
      const expiresAt = record.authExpiresAt ?? record.codexDeviceCode?.expiresAt
      if ((record.status === 'pending' || record.status === 'error') && expiresAt && expiresAt <= timestamp) {
        await rm(path.join(stateRoot(), file), { force: true })
      }
    } catch {
      // Corrupt state is retained for operator recovery and prevents reuse.
    }
  }
}

function providerTypes(providerId) {
  return new Set(providerId === 'kimi-ai' ? ['kimi', 'kimi-ai'] : [providerId])
}

function hasCredentialValue(value) {
  if (!value || typeof value !== 'object') return false
  for (const key of ['access_token', 'refresh_token', 'id_token', 'api_key', 'token']) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) return true
    if (candidate && typeof candidate === 'object' && hasCredentialValue(candidate)) return true
  }
  return false
}

function validateAuthFiles(providerId, authFiles, status) {
  if (!authFiles || typeof authFiles !== 'object' || Array.isArray(authFiles)) {
    throw new Error('Invalid encrypted subscription credentials')
  }
  const entries = Object.entries(authFiles)
  if (status === 'pending' && entries.length !== 0) {
    throw new Error('Pending subscription state contains credentials')
  }
  if (status === 'connected' && entries.length !== 1) {
    throw new Error('Subscription state must contain exactly one account')
  }
  if (status === 'error' && entries.length > 1) {
    throw new Error('Subscription state contains multiple accounts')
  }
  for (const [name, contents] of entries) {
    if (!/^[A-Za-z0-9._-]{1,120}\.json$/.test(name) ||
        typeof contents !== 'string' || contents.length === 0 || contents.length > 2_000_000) {
      throw new Error('Invalid encrypted subscription credentials')
    }
    let parsed
    try { parsed = JSON.parse(contents) } catch { throw new Error('Invalid encrypted subscription credentials') }
    if (!parsed || typeof parsed !== 'object' || !providerTypes(providerId).has(parsed.type) ||
        !hasCredentialValue(parsed)) {
      throw new Error('Encrypted subscription credentials belong to another provider')
    }
    if (providerId === 'codex' &&
        typeof parsed.account_id !== 'string' &&
        typeof parsed.chatgpt_account_id !== 'string') {
      throw new Error('Codex credentials are missing the account identity')
    }
  }
}

function validateRecord(record, identity) {
  if (!record || typeof record !== 'object' ||
      Object.keys(record).some((key) => !RECORD_FIELDS.has(key)) ||
      !validOwnerId(record.ownerId) || !validConnectionId(record.connectionId) ||
      keyFor(record.ownerId, record.connectionId) !== identity ||
      !knownProvider(record.providerId) ||
      !['pending', 'connected', 'error'].includes(record.status) ||
      typeof record.apiKey !== 'string' || record.apiKey.length < 32 ||
      typeof record.managementKey !== 'string' || record.managementKey.length < 32 ||
      !Array.isArray(record.enabledModelIds) || record.enabledModelIds.length > 400 ||
      new Set(record.enabledModelIds).size !== record.enabledModelIds.length ||
      !Array.isArray(record.discoveredModels) || record.discoveredModels.length > 400 ||
      record.discoveredModels.some((model) =>
        !model || typeof model !== 'object' || Array.isArray(model) ||
        typeof model.id !== 'string' || !/^[A-Za-z0-9._~:/@+-]{1,100}$/.test(model.id) ||
        (model.name !== undefined && (typeof model.name !== 'string' || model.name.length > 200))) ||
      record.enabledModelIds.some((id) =>
        typeof id !== 'string' || !record.discoveredModels.some((model) => model.id === id)) ||
      (record.oauthState !== undefined &&
        (typeof record.oauthState !== 'string' || record.oauthState.length > 512)) ||
      (record.authExpiresAt !== undefined &&
        (typeof record.authExpiresAt !== 'number' || !Number.isFinite(record.authExpiresAt))) ||
      (record.providerId === 'codex' &&
        (typeof record.authorizationGeneration !== 'string' ||
         record.authorizationGeneration.length < 32 ||
         !record.codexDeviceCode || typeof record.codexDeviceCode !== 'object' ||
         typeof record.codexDeviceCode.deviceAuthId !== 'string' ||
         typeof record.codexDeviceCode.userCode !== 'string' ||
         typeof record.codexDeviceCode.expiresAt !== 'number' ||
         typeof record.codexDeviceCode.interval !== 'number')) ||
      (record.providerId !== 'codex' &&
        (record.authorizationGeneration !== undefined ||
         record.codexDeviceCode !== undefined || record.codexPollLease !== undefined)) ||
      (record.codexPollLease !== undefined && record.codexPollLease !== null &&
        (!record.codexPollLease || typeof record.codexPollLease.token !== 'string' ||
         typeof record.codexPollLease.expiresAt !== 'number'))) {
    throw new Error('Encrypted subscription state is invalid; refusing to start')
  }
  validateAuthFiles(record.providerId, record.authFiles, record.status)
}

async function atomicSnapshot(record) {
  const identity = keyFor(record.ownerId, record.connectionId)
  const target = snapshotPath(identity)
  const temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`
  const backup = `${target}.bak`
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  let hasBackup = false
  let previousSnapshot
  try {
    const oldInfo = await lstat(target)
    if (!oldInfo.isFile() || oldInfo.isSymbolicLink() || oldInfo.size <= 0 ||
        oldInfo.size > MAX_SNAPSHOT_BYTES) {
      throw new Error('Unreadable encrypted subscription state')
    }
    previousSnapshot = await readFile(target)
    const backupHandle = await open(backup, 'wx', 0o600)
    try {
      await backupHandle.writeFile(previousSnapshot)
      await backupHandle.sync()
    } finally {
      await backupHandle.close()
    }
    hasBackup = true
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const handle = await open(temporary, 'wx', 0o600)
  let renamed = false
  try {
    await handle.writeFile(encrypt(record, `overlay-subscription:${identity}`))
    await handle.sync()
    await handle.close()
    await rename(temporary, target)
    renamed = true
    const directory = await open(path.dirname(target), 'r')
    try { await directory.sync() } finally { await directory.close() }
    if (hasBackup) {
      await rm(backup)
      const committedDirectory = await open(path.dirname(target), 'r')
      try { await committedDirectory.sync() } finally { await committedDirectory.close() }
      hasBackup = false
    }
  } catch (error) {
    if (hasBackup) {
      await rename(backup, target).catch(() => {})
      hasBackup = false
    } else if (renamed && previousSnapshot) {
      const rollback = `${target}.${randomBytes(8).toString('hex')}.tmp`
      try {
        const rollbackHandle = await open(rollback, 'wx', 0o600)
        try {
          await rollbackHandle.writeFile(previousSnapshot)
          await rollbackHandle.sync()
        } finally {
          await rollbackHandle.close()
        }
        await rename(rollback, target)
      } catch {
        await rm(rollback, { force: true }).catch(() => {})
      }
    } else if (renamed) {
      await rm(target, { force: true }).catch(() => {})
    }
    const rollbackDirectory = await open(path.dirname(target), 'r').catch(() => null)
    if (rollbackDirectory) {
      await rollbackDirectory.sync().catch(() => {})
      await rollbackDirectory.close().catch(() => {})
    }
    throw error
  } finally {
    await handle.close().catch(() => {})
    if (!renamed) await rm(temporary, { force: true }).catch(() => {})
  }
}

async function restoreRecords() {
  await mkdir(stateRoot(), { recursive: true, mode: 0o700 })
  await mkdir(runtimeRoot(), { recursive: true, mode: 0o700 })
  const stateInfo = await lstat(stateRoot())
  const runtimeInfo = await lstat(runtimeRoot())
  if (!stateInfo.isDirectory() || stateInfo.isSymbolicLink() ||
      !runtimeInfo.isDirectory() || runtimeInfo.isSymbolicLink()) {
    throw new Error('Subscription storage directories must be private directories')
  }
  await chmod(stateRoot(), 0o700)
  await chmod(runtimeRoot(), 0o700)
  try {
    const files = (await readdir(stateRoot())).sort((left, right) =>
      Number(SNAPSHOT_BACKUP_FILE.test(right)) - Number(SNAPSHOT_BACKUP_FILE.test(left)))
    for (const file of files) {
      if (file === '.broker.lock') continue
      if (SNAPSHOT_BACKUP_FILE.test(file)) {
        const backupPath = path.join(stateRoot(), file)
        const backupInfo = await lstat(backupPath)
        if (!backupInfo.isFile() || backupInfo.isSymbolicLink() ||
            backupInfo.size <= 0 || backupInfo.size > MAX_SNAPSHOT_BYTES) {
          throw new Error('Unreadable encrypted subscription state backup')
        }
        const target = backupPath.slice(0, -4)
        try {
          const targetInfo = await lstat(target)
          if (!targetInfo.isFile() || targetInfo.isSymbolicLink()) {
            throw new Error('Unreadable encrypted subscription state')
          }
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
        }
        await rename(backupPath, target)
        continue
      }
      if (SNAPSHOT_TEMP_FILE.test(file)) {
        const tempInfo = await lstat(path.join(stateRoot(), file))
        if (!tempInfo.isFile() || tempInfo.isSymbolicLink()) {
          throw new Error('Unexpected subscription state file')
        }
        await rm(path.join(stateRoot(), file), { force: true })
        continue
      }
      if (!SNAPSHOT_FILE.test(file)) throw new Error('Unexpected subscription state file')
      const filePath = path.join(stateRoot(), file)
      const fileInfo = await lstat(filePath)
      if (!fileInfo.isFile() || fileInfo.isSymbolicLink() ||
          fileInfo.size <= 0 || fileInfo.size > MAX_SNAPSHOT_BYTES) {
        throw new Error('Unreadable encrypted subscription state')
      }
      const identity = file.slice(0, -4)
      let record
      try {
        record = decrypt(await readFile(filePath, 'utf8'), `overlay-subscription:${identity}`)
      } catch {
        throw new Error('Encrypted subscription state is corrupt; refusing to start')
      }
      validateRecord(record, identity)
      if (record.status === 'connected') {
        if (workers.size >= MAX_WORKERS) {
          throw new Error('Recovered subscription state exceeds the configured worker limit')
        }
        const worker = await startWorker(record)
        workers.set(identity, worker)
        await snapshotWorker(worker)
      }
    }
  } catch (error) {
    await Promise.all([...workers.values()].map((worker) => stopWorker(worker, { removeSnapshot: false })))
    throw error
  }
}

async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = createTcpServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

function createWorkerConfig(record, port, authDir) {
  const yaml = JSON.stringify({
    host: '127.0.0.1',
    port,
    routing: { retry: { 'request-retry': 0 } },
    debug: false,
    access: { 'api-keys': [record.apiKey] },
    oauth: { 'auth-dir': authDir },
    'remote-management': {
      'allow-remote': false,
      'secret-key': record.managementKey,
      'disable-control-panel': true,
      'disable-auto-update-panel': true,
      'panel-github-repository': '',
    },
    plugins: { enabled: false, dir: path.join(runtimeRoot(), 'disabled-plugins'), configs: {} },
  })
  return yaml
}

async function startWorker(record) {
  const identity = keyFor(record.ownerId, record.connectionId)
  const root = path.join(runtimeRoot(), identity)
  const authDir = path.join(root, 'auth')
  validateRecord(record, identity)
  await rm(root, { recursive: true, force: true })
  await mkdir(authDir, { recursive: true, mode: 0o700 })
  await chmod(root, 0o700)
  await chmod(authDir, 0o700)
  for (const [name, contents] of Object.entries(record.authFiles ?? {})) {
    await writeFile(path.join(authDir, name), contents, { mode: 0o600 })
  }
  const port = await availablePort()
  const configPath = path.join(root, 'config.json')
  await writeFile(configPath, createWorkerConfig(record, port, authDir), { mode: 0o600 })
  const binary = process.env.CLIPROXYAPI_BIN ?? '/usr/local/bin/cli-proxy-api'
  const child = spawn(binary, ['--config', configPath, '--local-model', '--no-browser'], {
    cwd: root,
    env: { PATH: process.env.PATH ?? '', HOME: root, TMPDIR: root },
    stdio: 'ignore',
  })
  child.on('error', () => {
    void markWorkerUnusable(worker)
  })
  const worker = { ...record, identity, root, authDir, port, child, watcher: null, closed: false }
  try {
    await waitForWorker(worker)
    worker.watcher = watch(authDir, { persistent: false }, () => {
      void withLock(identity, () => snapshotWorker(worker)).catch(() => {
        void markWorkerUnusable(worker)
      })
    })
    worker.watcher.on('error', () => { void markWorkerUnusable(worker) })
    return worker
  } catch (error) {
    if (child.exitCode === null) child.kill('SIGKILL')
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

async function markWorkerUnusable(worker) {
  if (worker.closed) return
  worker.status = 'error'
  worker.closed = true
  worker.watcher?.close()
  if (worker.child.exitCode === null) worker.child.kill('SIGTERM')
  workers.delete(worker.identity)
  await rm(worker.root, { recursive: true, force: true }).catch(() => {})
}

async function waitForWorker(worker) {
  const started = now()
  while (now() - started < 20_000) {
    if (worker.child.exitCode !== null) throw new Error('Worker failed to start')
    try {
      const response = await fetch(`http://127.0.0.1:${worker.port}/healthz`, { signal: AbortSignal.timeout(500) })
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Worker failed to start')
}

async function snapshotWorker(worker) {
  if (worker.closed) return
  try {
    const names = await readdir(worker.authDir)
    const authFiles = {}
    for (const name of names) {
      if (!/^[A-Za-z0-9._-]{1,120}\.json$/.test(name)) {
        throw new Error('Unexpected subscription auth file')
      }
      const filePath = path.join(worker.authDir, name)
      const info = await lstat(filePath)
      if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > 2_000_000) {
        throw new Error('Unreadable subscription auth file')
      }
      authFiles[name] = await readFile(filePath, 'utf8')
    }
    validateAuthFiles(worker.providerId, authFiles, worker.status)
    const record = {
      ownerId: worker.ownerId,
      connectionId: worker.connectionId,
      providerId: worker.providerId,
      status: worker.status,
      apiKey: worker.apiKey,
      managementKey: worker.managementKey,
      authFiles,
      oauthState: worker.oauthState,
      authExpiresAt: worker.authExpiresAt,
      codexDeviceCode: worker.codexDeviceCode,
      authorizationGeneration: worker.authorizationGeneration,
      codexPollLease: worker.codexPollLease,
      enabledModelIds: worker.enabledModelIds,
      discoveredModels: worker.discoveredModels,
    }
    validateRecord(record, worker.identity)
    await atomicSnapshot(record)
    worker.authFiles = authFiles
  } catch (error) {
    await markWorkerUnusable(worker)
    throw error
  }
}

async function management(worker, pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:${worker.port}${pathname}`, {
    ...options,
    redirect: 'error',
    headers: {
      authorization: `Bearer ${worker.managementKey}`,
      ...(options.headers ?? {}),
    },
    signal: options.signal ?? AbortSignal.timeout(15_000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error('Worker management request failed')
  try { return JSON.parse(text) } catch { throw new Error('Worker management returned invalid data') }
}

function validAuthorizationUrl(providerId, value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && PROVIDERS[providerId].domains.includes(url.hostname.toLowerCase())
      ? url.toString()
      : null
  } catch {
    return null
  }
}

async function providerCall(record, pathName, body, signal) {
  const worker = workers.get(keyFor(record.ownerId, record.connectionId))
  if (!worker || worker.providerId !== record.providerId || worker.status !== 'connected') {
    throw subscriptionError(409, 'Subscription is not connected')
  }
  return await management(worker, pathName, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
}

async function startAuthorization(body) {
  const { ownerId, connectionId, providerId } = body
  assertEnabledProvider(providerId)
  const identity = keyFor(ownerId, connectionId)
  return await withLock(identity, async () => {
    if (providerId === 'codex') {
      throw subscriptionError(409, 'Codex authorization must use the Overlay device-code adapter')
    }
    if (workers.size >= MAX_WORKERS && !workers.has(identity)) {
      throw subscriptionError(503, 'Subscription capacity is full')
    }
    const previous = workers.get(identity)
    if (previous) await stopWorker(previous)
    const record = {
      ownerId, connectionId, providerId, status: 'pending', createdAt: now(),
      apiKey: randomBytes(32).toString('base64url'),
      managementKey: randomBytes(32).toString('base64url'),
      enabledModelIds: [], discoveredModels: [], authFiles: {},
    }
    const worker = await startWorker(record)
    workers.set(identity, worker)
    let auth
    try {
      auth = await management(worker, `/v8/management/oauth/auth-url?provider=${encodeURIComponent(providerId)}`)
      const url = validAuthorizationUrl(providerId, auth.url)
      if (!url || typeof auth.state !== 'string' || !auth.state || auth.state.length > 512) {
        throw subscriptionError(502, 'Provider returned invalid authorization data')
      }
      const expiresIn = Number(auth.expires_in ?? 900)
      const pollInterval = Number(auth.interval ?? 5)
      if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
        throw subscriptionError(502, 'Provider returned invalid authorization expiry')
      }
      worker.oauthState = auth.state
      worker.authExpiresAt = now() + Math.min(15 * 60_000, Math.max(60_000, expiresIn * 1000))
      await snapshotWorker(worker)
      return {
        authorization: {
          url,
          ...(typeof auth.user_code === 'string' ? { userCode: auth.user_code.slice(0, 128) } : {}),
          expiresAt: worker.authExpiresAt,
          interval: Math.min(30, Math.max(2, Number.isFinite(pollInterval) ? pollInterval : 5)),
          ...(providerId === 'devin' ? { callbackRequired: true } : {}),
        },
      }
    } catch (error) {
      await stopWorker(worker)
      throw error
    }
  })
}

async function startCodexAuthorization(body) {
  if (body.providerId !== 'codex' || !providerEnabled('codex')) {
    throw subscriptionError(400, 'Codex subscription is not enabled in this deployment')
  }
  if (typeof body.deviceAuthId !== 'string' || body.deviceAuthId.length > 512 ||
      typeof body.userCode !== 'string' || body.userCode.length > 128 ||
      typeof body.expiresAt !== 'number' || !Number.isFinite(body.expiresAt) ||
      typeof body.interval !== 'number' || !Number.isFinite(body.interval)) {
    throw subscriptionError(400, 'Invalid Codex device authorization')
  }
  const identity = keyFor(body.ownerId, body.connectionId)
  return await withLock('codex-pending-capacity', async () => {
    const pending = await pendingCodexIdentities()
    if (workers.size + pending.size >= MAX_WORKERS &&
        !workers.has(identity) && !pending.has(identity)) {
      throw subscriptionError(503, 'Subscription capacity is full')
    }
    return await withLock(identity, async () => {
      const previous = workers.get(identity)
      if (previous) await stopWorker(previous)
      const record = {
        ownerId: body.ownerId,
        connectionId: body.connectionId,
        providerId: 'codex',
        status: 'pending',
        apiKey: randomBytes(32).toString('base64url'),
        managementKey: randomBytes(32).toString('base64url'),
        authFiles: {},
        enabledModelIds: [],
        discoveredModels: [],
        codexDeviceCode: {
          deviceAuthId: body.deviceAuthId,
          userCode: body.userCode,
          expiresAt: body.expiresAt,
          interval: body.interval,
        },
        authorizationGeneration: randomBytes(24).toString('base64url'),
        codexPollLease: null,
      }
      await atomicSnapshot(record)
      return {
        authorization: {
          url: 'https://auth.openai.com/codex/device',
          userCode: body.userCode,
          expiresAt: body.expiresAt,
          interval: body.interval,
        },
      }
    })
  })
}

async function pendingCodexIdentities() {
  const files = await readdir(stateRoot())
  const identities = new Set()
  for (const file of files) {
    if (file === '.broker.lock' || SNAPSHOT_BACKUP_FILE.test(file) ||
        SNAPSHOT_TEMP_FILE.test(file)) continue
    if (!SNAPSHOT_FILE.test(file)) throw new Error('Unexpected subscription state file')
    const identity = file.slice(0, -4)
    const filePath = path.join(stateRoot(), file)
    const info = await lstat(filePath)
    if (!info.isFile() || info.isSymbolicLink() ||
        info.size <= 0 || info.size > MAX_SNAPSHOT_BYTES) {
      throw new Error('Unreadable encrypted subscription state')
    }
    const record = decrypt(await readFile(filePath, 'utf8'), `overlay-subscription:${identity}`)
    validateRecord(record, identity)
    if (record.providerId === 'codex' && record.status === 'pending' &&
        record.codexDeviceCode.expiresAt > now()) {
      identities.add(identity)
    }
  }
  return identities
}

async function getCodexDeviceCode(body) {
  const identity = keyFor(body.ownerId, body.connectionId)
  return await withLock(identity, async () => {
    let serialized
    try {
      serialized = await readFile(snapshotPath(identity), 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') throw subscriptionError(404, 'Codex authorization not found')
      throw subscriptionError(503, 'Codex authorization state is unavailable')
    }
    let record
    try { record = decrypt(serialized, `overlay-subscription:${identity}`) } catch {
      throw subscriptionError(503, 'Codex authorization state is unavailable')
    }
    validateRecord(record, identity)
    if (record.ownerId !== body.ownerId || record.connectionId !== body.connectionId ||
        record.providerId !== 'codex') {
      throw subscriptionError(404, 'Codex authorization not found')
    }
    if (record.status === 'connected') {
      return { status: 'connected', models: record.discoveredModels }
    }
    if (record.status !== 'pending') {
      return { status: record.codexDeviceCode?.expiresAt <= now() ? 'expired' : 'error' }
    }
    if (!record.codexDeviceCode) throw subscriptionError(404, 'Codex authorization not found')
    if (record.codexDeviceCode.expiresAt <= now()) {
      record.status = 'error'
      record.codexPollLease = null
      await atomicSnapshot(record)
      return { status: 'expired' }
    }
    if (record.codexPollLease?.expiresAt > now()) {
      return { status: 'polling' }
    }
    const lease = {
      token: randomBytes(32).toString('base64url'),
      expiresAt: now() + 20_000,
    }
    record.codexPollLease = lease
    await atomicSnapshot(record)
    return {
      status: 'pending',
      deviceCode: record.codexDeviceCode,
      authorizationGeneration: record.authorizationGeneration,
      pollLease: lease,
    }
  })
}

async function releaseCodexPoll(body) {
  const identity = keyFor(body.ownerId, body.connectionId)
  return await withLock(identity, async () => {
    let serialized
    try {
      serialized = await readFile(snapshotPath(identity), 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return { released: false }
      throw subscriptionError(503, 'Codex authorization state is unavailable')
    }
    let record
    try { record = decrypt(serialized, `overlay-subscription:${identity}`) } catch {
      throw subscriptionError(503, 'Codex authorization state is unavailable')
    }
    validateRecord(record, identity)
    if (record.ownerId !== body.ownerId || record.connectionId !== body.connectionId ||
        record.providerId !== 'codex' || record.status === 'connected' ||
        typeof body.authorizationGeneration !== 'string' ||
        body.authorizationGeneration !== record.authorizationGeneration ||
        !record.codexPollLease || typeof body.pollLease !== 'string' ||
        record.codexPollLease.expiresAt <= now() ||
        !constantTimeSecret(record.codexPollLease.token, body.pollLease)) return { released: false }
    record.codexPollLease = null
    await atomicSnapshot(record)
    return { released: true }
  })
}

async function pollAuthorization(body) {
  const identity = keyFor(body.ownerId, body.connectionId)
  return await withLock(identity, async () => {
    const worker = workers.get(identity)
    if (!worker || worker.providerId !== body.providerId) throw subscriptionError(404, 'Subscription authorization not found')
    if (worker.status === 'connected') return await connectedResult(worker)
    if (worker.authExpiresAt && worker.authExpiresAt <= now()) {
      await stopWorker(worker)
      return { status: 'expired' }
    }
    const status = await management(worker, `/v8/management/oauth/status?state=${encodeURIComponent(worker.oauthState ?? '')}`)
    if (status.status === 'wait') return { status: 'pending' }
    if (status.status !== 'ok') return { status: 'error', error: 'Authorization was rejected. Start again.' }
    worker.status = 'connected'
    let discovered
    try {
      discovered = await discoverModels(worker)
    } catch (error) {
      worker.status = 'error'
      await snapshotWorker(worker)
      throw subscriptionError(502, 'The provider model catalog could not be discovered')
    }
    const previous = worker.discoveredModels.length > 0 ? worker.enabledModelIds : undefined
    worker.discoveredModels = discovered
    worker.enabledModelIds = previous
      ? previous.filter((id) => discovered.some((model) => model.id === id))
      : discovered.map((model) => model.id)
    await snapshotWorker(worker)
    return await connectedResult(worker)
  })
}

async function callbackAuthorization(body) {
  const identity = keyFor(body.ownerId, body.connectionId)
  return await withLock(identity, async () => {
    const worker = workers.get(identity)
    if (!worker || worker.providerId !== 'devin' || typeof body.callbackUrl !== 'string') {
      throw subscriptionError(404, 'Subscription authorization not found')
    }
    let callback
    try { callback = new URL(body.callbackUrl) } catch { throw subscriptionError(400, 'Invalid authorization callback') }
    if (callback.protocol !== 'http:' ||
        !['127.0.0.1', 'localhost'].includes(callback.hostname) ||
        callback.username || callback.password || callback.hash ||
        callback.pathname !== '/callback' ||
        callback.searchParams.getAll('state').length !== 1 ||
        callback.searchParams.get('state') !== worker.oauthState ||
        callback.searchParams.getAll('code').length !== 1 ||
        !callback.searchParams.has('code') ||
        callback.href.length > 4096) {
      throw subscriptionError(400, 'The returned callback does not match this authorization')
    }
    await management(worker, '/v8/management/oauth/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'devin', redirect_url: callback.toString() }),
    })
    if ((await readdir(worker.authDir)).length > 0) {
      worker.status = 'connected'
      try {
        worker.discoveredModels = await discoverModels(worker)
      } catch {
        worker.status = 'error'
        await snapshotWorker(worker)
        throw subscriptionError(502, 'The provider model catalog could not be discovered')
      }
      worker.enabledModelIds = worker.discoveredModels.map((model) => model.id)
      await snapshotWorker(worker)
      return { status: 'connected', models: worker.discoveredModels }
    }
    await snapshotWorker(worker)
    return { status: 'pending' }
  })
}

async function importCodex(body) {
  const identity = keyFor(body.ownerId, body.connectionId)
  return await withLock(identity, async () => {
    let worker = workers.get(identity)
    if (worker && (worker.providerId !== 'codex' || worker.status !== 'pending')) {
      throw subscriptionError(403, 'Codex authorization is not pending')
    }
    let serialized
    try {
      serialized = await readFile(snapshotPath(identity), 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') throw subscriptionError(404, 'Codex authorization not found')
      throw subscriptionError(503, 'Codex authorization state is unavailable')
    }
    let pending
    try { pending = decrypt(serialized, `overlay-subscription:${identity}`) } catch {
      throw subscriptionError(503, 'Codex authorization state is unavailable')
    }
    validateRecord(pending, identity)
    if (pending.ownerId !== body.ownerId || pending.connectionId !== body.connectionId ||
        pending.providerId !== 'codex' || pending.status !== 'pending' ||
        typeof body.authorizationGeneration !== 'string' ||
        body.authorizationGeneration !== pending.authorizationGeneration ||
        typeof body.pollLease !== 'string' ||
        !pending.codexPollLease ||
        !constantTimeSecret(pending.codexPollLease.token, body.pollLease) ||
        pending.codexPollLease.expiresAt <= now()) {
      throw subscriptionError(403, 'Codex authorization lease is stale')
    }
    if (!worker) {
      if (workers.size >= MAX_WORKERS) throw subscriptionError(503, 'Subscription capacity is full')
      const record = {
        ownerId: body.ownerId, connectionId: body.connectionId, providerId: 'codex',
        status: 'pending', apiKey: randomBytes(32).toString('base64url'),
        managementKey: randomBytes(32).toString('base64url'), enabledModelIds: [], discoveredModels: [], authFiles: {},
        codexDeviceCode: pending.codexDeviceCode,
        authorizationGeneration: pending.authorizationGeneration,
        codexPollLease: pending.codexPollLease,
      }
      worker = await startWorker(record)
      workers.set(identity, worker)
    }
    const token = body.tokens
    if (!isTokenSet(token)) {
      throw subscriptionError(400, 'Codex authorization token is invalid')
    }
    const expiry = typeof token.expired === 'string' ? token.expired : ''
    if (!Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= now() ||
        !/^[A-Za-z0-9_-]{1,256}$/.test(token.accountId ?? '')) {
      throw subscriptionError(400, 'Codex authorization token has expired')
    }
    const authFile = {
      type: 'codex', access_token: token.accessToken, refresh_token: token.refreshToken,
      id_token: token.idToken, account_id: token.accountId, expired: expiry,
      last_refresh: new Date(token.lastRefresh).toISOString(),
    }
    await management(worker, '/v8/management/credentials?name=overlay-codex.json', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(authFile),
    })
    worker.status = 'connected'
    try {
      worker.discoveredModels = await discoverModels(worker)
    } catch {
      worker.status = 'error'
      await snapshotWorker(worker)
      throw subscriptionError(502, 'The provider model catalog could not be discovered')
    }
    worker.enabledModelIds = worker.discoveredModels.map((model) => model.id)
    await snapshotWorker(worker)
    return await connectedResult(worker)
  })
}

function isTokenSet(value) {
  return Boolean(value && typeof value === 'object' &&
    ['idToken', 'accessToken', 'refreshToken'].every((key) => typeof value[key] === 'string' && value[key].length > 20) &&
    typeof value.lastRefresh === 'number' && Number.isFinite(value.lastRefresh) &&
    typeof value.accountId === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value.accountId))
}

async function discoverModels(worker) {
  const response = await fetch(`http://127.0.0.1:${worker.port}/v1/models`, {
    headers: { authorization: `Bearer ${worker.apiKey}` },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error('Model discovery failed')
  const payload = await response.json()
  if (!Array.isArray(payload.data)) throw new Error('Model discovery response invalid')
  return payload.data
    .filter((model) => model && typeof model.id === 'string' && /^[A-Za-z0-9._~:/@+-]{1,100}$/.test(model.id))
    .slice(0, 400)
    .map((model) => ({ id: model.id, name: typeof model.display_name === 'string' ? model.display_name.slice(0, 200) : model.id }))
}

async function connectedResult(worker) {
  await snapshotWorker(worker)
  return { status: 'connected', models: worker.discoveredModels }
}

async function refreshAuthorization(body) {
  const identity = keyFor(body.ownerId, body.connectionId)
  return await withLock(identity, async () => {
    const worker = workers.get(identity)
    if (!worker || worker.providerId !== body.providerId || worker.status !== 'connected') {
      throw subscriptionError(409, 'Subscription is not connected')
    }
    const discovered = await discoverModels(worker).catch(async () => {
      worker.status = 'error'
      await snapshotWorker(worker)
      throw subscriptionError(502, 'The provider model catalog could not be discovered')
    })
    const previous = worker.enabledModelIds
    worker.discoveredModels = discovered
    worker.enabledModelIds = previous.filter((id) => discovered.some((model) => model.id === id))
    await snapshotWorker(worker)
    return { status: 'connected', models: worker.discoveredModels }
  })
}

async function setModels(body) {
  const identity = keyFor(body.ownerId, body.connectionId)
  return await withLock(identity, async () => {
    const worker = workers.get(identity)
    if (!worker || worker.providerId !== body.providerId || !Array.isArray(body.enabledModelIds)) {
      throw subscriptionError(404, 'Subscription connection not found')
    }
    const discoveredIds = new Set(worker.discoveredModels.map((model) => model.id))
    if (body.enabledModelIds.some((id) => typeof id !== 'string' || !discoveredIds.has(id))) {
      throw subscriptionError(400, 'Enabled models must be discovered for this account')
    }
    worker.enabledModelIds = [...new Set(body.enabledModelIds)].slice(0, 400)
    await snapshotWorker(worker)
    return { status: 'connected' }
  })
}

async function stopWorker(worker, { removeSnapshot = true } = {}) {
  worker.closed = true
  worker.watcher?.close()
  if (worker.child.exitCode === null) {
    worker.child.kill('SIGTERM')
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000)
      worker.child.once('exit', () => { clearTimeout(timer); resolve() })
    })
    if (worker.child.exitCode === null) worker.child.kill('SIGKILL')
  }
  workers.delete(worker.identity)
  let cleanupError
  try {
    await rm(worker.root, { recursive: true, force: true })
  } catch (error) {
    cleanupError = error
  }
  if (removeSnapshot && !cleanupError) {
    try {
      await rm(snapshotPath(worker.identity), { force: true })
    } catch (error) {
      cleanupError = error
    }
  }
  if (cleanupError) throw cleanupError
}

async function shutdownWorkers() {
  await Promise.all([...workers.values()].map(async (worker) => {
    await withLock(worker.identity, async () => {
      try { await snapshotWorker(worker) } catch { worker.status = 'error' }
      await stopWorker(worker, { removeSnapshot: false }).catch(() => {})
    })
  }))
}

async function disconnect(body) {
  const identity = keyFor(body.ownerId, body.connectionId)
  return await withLock(identity, async () => {
    const worker = workers.get(identity)
    if (worker && worker.providerId !== body.providerId) throw subscriptionError(403, 'Subscription provider mismatch')
    if (worker) await stopWorker(worker)
    else {
      const target = snapshotPath(identity)
      let serialized
      try {
        const info = await lstat(target)
        if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 ||
            info.size > MAX_SNAPSHOT_BYTES) {
          throw new Error('Unreadable encrypted subscription state')
        }
        serialized = await readFile(target, 'utf8')
      } catch (error) {
        if (error?.code === 'ENOENT') return { disconnected: true }
        throw error
      }
      const record = decrypt(serialized, `overlay-subscription:${identity}`)
      validateRecord(record, identity)
      if (record.providerId !== body.providerId) {
        throw subscriptionError(403, 'Subscription provider mismatch')
      }
      await rm(target)
    }
    return { disconnected: true }
  })
}

async function inference(request, response, pathname) {
  const ownerId = request.headers['x-overlay-owner-id']
  const connectionId = request.headers['x-overlay-connection-id']
  if (!validOwnerId(ownerId) || !validConnectionId(connectionId)) {
    throw subscriptionError(400, 'Invalid owner or connection')
  }
  const identity = keyFor(ownerId, connectionId)
  const controller = new AbortController()
  const abort = () => controller.abort()
  request.once('aborted', abort)
  response.once('close', () => { if (!response.writableEnded) controller.abort() })
  try {
    const body = await readJson(request)
    assertSupportedSubscriptionRequest(body)
    assertOverlayTools(body)
    if (controller.signal.aborted) {
      response.destroy()
      return
    }
    await withLock(identity, async () => {
      if (controller.signal.aborted) {
        response.destroy()
        return
      }
      const worker = workers.get(identity)
      if (!worker || worker.status !== 'connected' ||
          worker.ownerId !== ownerId || worker.connectionId !== connectionId ||
          !providerEnabled(worker.providerId)) {
        throw subscriptionError(404, 'Subscription connection not found')
      }
      if ((worker.providerId === 'codex') !== (pathname === '/v1/responses')) {
        throw subscriptionError(400, 'This subscription requires its provider protocol')
      }
      if (typeof body.model !== 'string' || !worker.enabledModelIds.includes(body.model)) {
        throw subscriptionError(403, 'Model is not enabled for this subscription')
      }
      let upstream
      try {
        upstream = await fetch(`http://127.0.0.1:${worker.port}${pathname}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${worker.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
          redirect: 'error',
        })
      } catch (error) {
        await snapshotWorker(worker)
        throw error
      }
      if (!upstream.ok) {
        await upstream.body?.cancel().catch(() => undefined)
        await snapshotWorker(worker)
        if (!response.headersSent && !response.destroyed) {
          response.writeHead(upstream.status >= 500 ? 502 : upstream.status, {
            'content-type': 'application/json', 'cache-control': 'no-store',
          }).end(JSON.stringify({ error: 'Upstream provider request failed', category: 'subscription_upstream_error' }))
        }
        return
      }
      if (!response.headersSent) {
        response.writeHead(upstream.status, Object.fromEntries(
          [...upstream.headers].filter(([name]) => ['content-type', 'cache-control', 'x-request-id'].includes(name.toLowerCase())),
        ))
      }
      if (upstream.body) {
        try {
          for await (const chunk of upstream.body) {
            if (!response.write(chunk)) {
              await new Promise((resolve, reject) => {
                const done = () => { cleanup(); resolve() }
                const fail = () => { cleanup(); reject(new Error('Client disconnected')) }
              const cleanup = () => {
                  response.off('drain', done)
                  response.off('close', fail)
                  response.off('error', fail)
                  controller.signal.removeEventListener('abort', fail)
                }
              response.once('drain', done)
                response.once('close', fail)
                response.once('error', fail)
                controller.signal.addEventListener('abort', fail, { once: true })
                if (controller.signal.aborted || response.destroyed || response.writableEnded) fail()
                else if (!response.writableNeedDrain) done()
            })
            }
          }
        } catch (error) {
          await snapshotWorker(worker)
          if (response.headersSent) response.destroy()
          throw error
        }
      }
      await snapshotWorker(worker)
      if (!response.writableEnded && !controller.signal.aborted) response.end()
    })
  } finally {
    request.off('aborted', abort)
  }
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw subscriptionError(413, 'Request body too large')
    chunks.push(chunk)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value
  } catch {
    throw subscriptionError(400, 'Invalid request body')
  }
}

async function handleManagement(pathname, body) {
  if (!validOwnerId(body.ownerId) || !validConnectionId(body.connectionId)) {
    throw subscriptionError(400, 'Invalid owner or connection')
  }
  if (pathname.endsWith('/start')) return await startAuthorization(body)
  if (pathname.endsWith('/start-codex')) return await startCodexAuthorization(body)
  if (!knownProvider(body.providerId)) throw subscriptionError(400, 'Unsupported subscription provider')
  if (pathname.endsWith('/poll') || pathname.endsWith('/refresh') ||
      pathname.endsWith('/callback') || pathname.endsWith('/import-codex')) {
    assertEnabledProvider(body.providerId)
  }
  if (pathname.endsWith('/codex-device') || pathname.endsWith('/codex-release') ||
      pathname.endsWith('/import-codex')) {
    if (body.providerId !== 'codex') throw subscriptionError(400, 'Codex provider is required')
  }
  if (pathname.endsWith('/poll') && body.providerId === 'codex') {
    throw subscriptionError(400, 'Codex authorization must use the device-code poll route')
  }
  if (pathname.endsWith('/callback') && body.providerId !== 'devin') {
    throw subscriptionError(400, 'Devin provider is required')
  }
  if (pathname.endsWith('/codex-device')) return await getCodexDeviceCode(body)
  if (pathname.endsWith('/codex-release')) return await releaseCodexPoll(body)
  if (pathname.endsWith('/poll')) return await pollAuthorization(body)
  if (pathname.endsWith('/refresh')) return await refreshAuthorization(body)
  if (pathname.endsWith('/callback')) return await callbackAuthorization(body)
  if (pathname.endsWith('/import-codex')) return await importCodex(body)
  if (pathname.endsWith('/models')) return await setModels(body)
  if (pathname.endsWith('/disconnect')) return await disconnect(body)
  throw subscriptionError(404, 'Route not found')
}

export async function createBrokerServer(options = {}) {
  clock = typeof options.now === 'function' ? options.now : () => Date.now()
  const serviceKey = options.serviceKey ?? process.env.OVERLAY_SUBSCRIPTION_BROKER_KEY ?? ''
  if (Buffer.byteLength(serviceKey) < 32) throw new Error('OVERLAY_SUBSCRIPTION_BROKER_KEY must be at least 32 bytes')
  masterKey()
  await acquireSingletonLock()
  try {
    await restoreRecords()
  } catch (error) {
    await releaseSingletonLock().catch(() => {})
    throw error
  }
  const server = createServer(async (request, response) => {
    try {
      const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '')
      if (!constantTimeSecret(serviceKey, supplied)) {
        response.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"Unauthorized"}')
        return
      }
      if (request.method === 'GET' && request.url === '/healthz') {
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({
          status: 'ok',
          capabilities: { protocols: ['chat', 'responses'], providers: [...configuredProviders('OVERLAY_SUBSCRIPTION_BROKER_ENABLED_PROVIDERS')] },
        }))
        return
      }
      const pathname = new URL(request.url, 'http://localhost').pathname
      if (request.method === 'POST' && ['/v1/chat/completions', '/v1/responses'].includes(pathname)) {
        await inference(request, response, pathname)
        return
      }
      if (request.method === 'POST' && pathname.startsWith('/v1/subscriptions/')) {
        const body = await readJson(request)
        const result = await handleManagement(pathname, body)
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          .end(JSON.stringify(result))
        return
      }
      response.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"Not found"}')
    } catch (error) {
      const result = serializeError(error)
      if (response.headersSent) {
        response.destroy()
      } else {
        response.writeHead(result.status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          .end(JSON.stringify(result.body))
      }
    }
  })
  const host = options.host ?? process.env.OVERLAY_SUBSCRIPTION_BROKER_HOST ?? '127.0.0.1'
  const port = options.port ?? Number(process.env.PORT ?? 8088)
  server.listen(port, host)
  reaper = setInterval(() => { void reapExpiredState() }, 30_000)
  reaper.unref?.()
  server.shutdown = async () => {
    if (reaper) clearInterval(reaper)
    reaper = null
    await new Promise((resolve) => server.close(() => resolve()))
    await shutdownWorkers()
    await releaseSingletonLock()
    clock = () => Date.now()
  }
  return server
}

export { constantTimeSecret, decrypt, encrypt, keyFor, validAuthorizationUrl }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createBrokerServer().then((server) => {
    const shutdown = () => {
      server.closeAllConnections()
      void server.shutdown().finally(() => process.exit(0))
    }
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
  }).catch(() => process.exitCode = 1)
}
