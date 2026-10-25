import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { chmod, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
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
const now = () => Date.now()

function keyFor(ownerId, connectionId) {
  return createHash('sha256').update(`${ownerId}\0${connectionId}`).digest('hex')
}

function allowedProvider(providerId) {
  return Object.hasOwn(PROVIDERS, providerId)
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

async function atomicSnapshot(record) {
  const identity = keyFor(record.ownerId, record.connectionId)
  const target = snapshotPath(identity)
  const temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(encrypt(record, `overlay-subscription:${identity}`))
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, target)
  const directory = await open(path.dirname(target), 'r')
  try { await directory.sync() } finally { await directory.close() }
}

async function restoreRecords() {
  await mkdir(stateRoot(), { recursive: true, mode: 0o700 })
  await mkdir(runtimeRoot(), { recursive: true, mode: 0o700 })
  await chmod(stateRoot(), 0o700)
  await chmod(runtimeRoot(), 0o700)
  try {
    const files = await readdir(stateRoot())
    for (const file of files) {
      if (!file.endsWith('.enc')) continue
      const identity = file.slice(0, -4)
      let record
      try {
        record = decrypt(await readFile(path.join(stateRoot(), file), 'utf8'), `overlay-subscription:${identity}`)
      } catch {
        throw new Error('Encrypted subscription state is corrupt; refusing to start')
      }
      if (!record || keyFor(record.ownerId, record.connectionId) !== identity || !allowedProvider(record.providerId)) {
        throw new Error('Encrypted subscription state is invalid; refusing to start')
      }
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
    'request-retry': 0,
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
  await mkdir(authDir, { recursive: true, mode: 0o700 })
  await chmod(root, 0o700)
  await chmod(authDir, 0o700)
  for (const [name, contents] of Object.entries(record.authFiles ?? {})) {
    if (!/^[A-Za-z0-9._-]{1,120}\.json$/.test(name)) throw new Error('Invalid auth snapshot')
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
  child.on('error', () => {})
  const worker = { ...record, identity, root, authDir, port, child, watcher: null, closed: false }
  try {
    await waitForWorker(worker)
    worker.watcher = watch(authDir, { persistent: false }, () => {
      void withLock(identity, () => snapshotWorker(worker)).catch(() => {})
    })
    return worker
  } catch (error) {
    if (child.exitCode === null) child.kill('SIGKILL')
    await rm(root, { recursive: true, force: true }).catch(() => {})
    throw error
  }
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
  const names = await readdir(worker.authDir).catch(() => [])
  const authFiles = {}
  for (const name of names) {
    if (!/^[A-Za-z0-9._-]{1,120}\.json$/.test(name)) continue
    const info = await stat(path.join(worker.authDir, name)).catch(() => null)
    if (!info?.isFile() || info.size > 2_000_000) continue
    authFiles[name] = await readFile(path.join(worker.authDir, name), 'utf8')
  }
  worker.authFiles = authFiles
  await atomicSnapshot({
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
    codexPollUntil: worker.codexPollUntil,
    enabledModelIds: worker.enabledModelIds,
    discoveredModels: worker.discoveredModels,
  })
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
  if (!allowedProvider(providerId)) throw subscriptionError(400, 'Unsupported subscription provider')
  const identity = keyFor(ownerId, connectionId)
  return await withLock(identity, async () => {
    if (providerId === 'codex') {
      throw subscriptionError(409, 'Codex authorization must use the Overlay device-code adapter')
    }
    if (workers.size >= MAX_WORKERS) throw subscriptionError(503, 'Subscription capacity is full')
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
  if (typeof body.deviceAuthId !== 'string' || body.deviceAuthId.length > 512 ||
      typeof body.userCode !== 'string' || body.userCode.length > 128 ||
      typeof body.expiresAt !== 'number' || !Number.isFinite(body.expiresAt) ||
      typeof body.interval !== 'number' || !Number.isFinite(body.interval)) {
    throw subscriptionError(400, 'Invalid Codex device authorization')
  }
  const identity = keyFor(body.ownerId, body.connectionId)
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
      codexPollUntil: 0,
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
}

async function getCodexDeviceCode(body) {
  const identity = keyFor(body.ownerId, body.connectionId)
  return await withLock(identity, async () => {
    const serialized = await readFile(snapshotPath(identity), 'utf8').catch(() => '')
    if (!serialized) throw subscriptionError(404, 'Codex authorization not found')
    let record
    try { record = decrypt(serialized, `overlay-subscription:${identity}`) } catch {
      throw subscriptionError(503, 'Codex authorization state is unavailable')
    }
    if (record.ownerId !== body.ownerId || record.connectionId !== body.connectionId ||
        record.providerId !== 'codex') {
      throw subscriptionError(404, 'Codex authorization not found')
    }
    if (record.status === 'connected') {
      return { status: 'connected', models: record.discoveredModels }
    }
    if (!record.codexDeviceCode) throw subscriptionError(404, 'Codex authorization not found')
    if (record.codexDeviceCode.expiresAt <= now()) return { status: 'expired' }
    if (record.status === 'connected') return { status: 'connected' }
    if ((record.codexPollUntil ?? 0) > now()) return { status: 'polling' }
    record.codexPollUntil = now() + 20_000
    await atomicSnapshot(record)
    return { status: 'pending', deviceCode: record.codexDeviceCode }
  })
}

async function releaseCodexPoll(body) {
  const identity = keyFor(body.ownerId, body.connectionId)
  return await withLock(identity, async () => {
    const serialized = await readFile(snapshotPath(identity), 'utf8').catch(() => '')
    if (!serialized) return { released: false }
    const record = decrypt(serialized, `overlay-subscription:${identity}`)
    if (record.ownerId !== body.ownerId || record.connectionId !== body.connectionId ||
        record.providerId !== 'codex' || record.status === 'connected') return { released: false }
    record.codexPollUntil = 0
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
    const discovered = await discoverModels(worker)
    worker.discoveredModels = discovered
    worker.enabledModelIds = discovered.map((model) => model.id)
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
    await snapshotWorker(worker)
    return { status: 'pending' }
  })
}

async function importCodex(body) {
  const identity = keyFor(body.ownerId, body.connectionId)
  return await withLock(identity, async () => {
    let worker = workers.get(identity)
    if (worker && worker.providerId !== 'codex') throw subscriptionError(409, 'Connection provider mismatch')
    if (!worker) {
      if (workers.size >= MAX_WORKERS) throw subscriptionError(503, 'Subscription capacity is full')
      const serialized = await readFile(snapshotPath(identity), 'utf8').catch(() => '')
      if (!serialized) throw subscriptionError(404, 'Codex authorization not found')
      let pending
      try { pending = decrypt(serialized, `overlay-subscription:${identity}`) } catch {
        throw subscriptionError(503, 'Codex authorization state is unavailable')
      }
      if (pending.ownerId !== body.ownerId || pending.connectionId !== body.connectionId ||
          pending.providerId !== 'codex' || !pending.codexDeviceCode ||
          (pending.codexPollUntil ?? 0) <= now()) {
        throw subscriptionError(403, 'Codex authorization is not pending')
      }
      const record = {
        ownerId: body.ownerId, connectionId: body.connectionId, providerId: 'codex',
        status: 'pending', apiKey: randomBytes(32).toString('base64url'),
        managementKey: randomBytes(32).toString('base64url'), enabledModelIds: [], discoveredModels: [], authFiles: {},
      }
      worker = await startWorker(record)
      workers.set(identity, worker)
    }
    const token = body.tokens
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
    worker.discoveredModels = await discoverModels(worker)
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
  await rm(worker.root, { recursive: true, force: true }).catch(() => {})
  if (removeSnapshot) await rm(snapshotPath(worker.identity), { force: true }).catch(() => {})
}

async function shutdownWorkers() {
  await Promise.all([...workers.values()].map(async (worker) => {
    await withLock(worker.identity, async () => {
      await snapshotWorker(worker).catch(() => {})
      await stopWorker(worker, { removeSnapshot: false })
    })
  }))
}

async function disconnect(body) {
  const identity = keyFor(body.ownerId, body.connectionId)
  return await withLock(identity, async () => {
    const worker = workers.get(identity)
    if (worker && worker.providerId !== body.providerId) throw subscriptionError(403, 'Subscription provider mismatch')
    if (worker) await stopWorker(worker)
    else await rm(snapshotPath(identity), { force: true })
    return { disconnected: true }
  })
}

async function inference(request, response, pathname) {
  const ownerId = request.headers['x-overlay-owner-id']
  const connectionId = request.headers['x-overlay-connection-id']
  const identity = keyFor(ownerId, connectionId)
  const worker = workers.get(identity)
  if (!worker || worker.status !== 'connected' || worker.ownerId !== ownerId || worker.connectionId !== connectionId) {
    throw subscriptionError(404, 'Subscription connection not found')
  }
  const body = await readJson(request)
  assertSupportedSubscriptionRequest(body)
  if (typeof body.model !== 'string' || !worker.enabledModelIds.includes(body.model)) {
    throw subscriptionError(403, 'Model is not enabled for this subscription')
  }
  if (body.tools?.some((tool) => tool?.type === 'computer' || tool?.type === 'browser' || tool?.type === 'file_search')) {
    throw subscriptionError(400, 'This subscription does not support that tool')
  }
  await snapshotWorker(worker)
  const controller = new AbortController()
  const abort = () => controller.abort()
  request.once('aborted', abort)
  response.once('close', () => { if (!response.writableEnded) controller.abort() })
  const upstream = await fetch(`http://127.0.0.1:${worker.port}${pathname}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${worker.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
    redirect: 'error',
  })
  response.writeHead(upstream.status, Object.fromEntries(
    [...upstream.headers].filter(([name]) => ['content-type', 'cache-control', 'x-request-id'].includes(name.toLowerCase())),
  ))
  if (!upstream.body) {
    response.end()
    return
  }
  try {
    for await (const chunk of upstream.body) {
      if (!response.write(chunk)) await new Promise((resolve) => response.once('drain', resolve))
    }
    response.end()
  } finally {
    await snapshotWorker(worker)
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
  if (typeof body.ownerId !== 'string' || !body.ownerId || body.ownerId.length > 256 ||
      typeof body.connectionId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.connectionId)) {
    throw subscriptionError(400, 'Invalid owner or connection')
  }
  if (pathname.endsWith('/start')) return await startAuthorization(body)
  if (!allowedProvider(body.providerId)) throw subscriptionError(400, 'Unsupported subscription provider')
  if (pathname.endsWith('/start-codex')) return await startCodexAuthorization(body)
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
  const serviceKey = options.serviceKey ?? process.env.OVERLAY_SUBSCRIPTION_BROKER_KEY ?? ''
  if (Buffer.byteLength(serviceKey) < 32) throw new Error('OVERLAY_SUBSCRIPTION_BROKER_KEY must be at least 32 bytes')
  masterKey()
  await restoreRecords()
  const server = createServer(async (request, response) => {
    try {
      const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '')
      if (!constantTimeSecret(serviceKey, supplied)) {
        response.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"Unauthorized"}')
        return
      }
      if (request.method === 'GET' && request.url === '/healthz') {
        response.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}')
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
      response.writeHead(result.status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify(result.body))
    }
  })
  const host = options.host ?? process.env.OVERLAY_SUBSCRIPTION_BROKER_HOST ?? '127.0.0.1'
  const port = options.port ?? Number(process.env.PORT ?? 8088)
  server.listen(port, host)
  return server
}

export { constantTimeSecret, decrypt, encrypt, keyFor, validAuthorizationUrl }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createBrokerServer().then((server) => {
    const shutdown = () => {
      server.closeAllConnections()
      server.close()
      void shutdownWorkers().finally(() => process.exit(0))
    }
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
  }).catch(() => process.exitCode = 1)
}
