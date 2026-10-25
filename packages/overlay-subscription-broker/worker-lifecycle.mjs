import { spawn } from 'node:child_process'
import { createServer as createTcpServer } from 'node:net'
import { chmod, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { watch } from 'node:fs'
import path from 'node:path'
import { keyFor, now, subscriptionError, workers, withLock } from './state.mjs'
import { atomicSnapshot, decrypt, runtimeRoot, snapshotPath } from './persistence.mjs'
import {
  hasCredentialValue,
  providerTypes,
  validateAuthFiles,
  validateRecord,
} from './record-validation.mjs'

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
  return JSON.stringify({
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
}

export async function startWorker(record) {
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
      if (worker.status !== 'connected') return
      void withLock(identity, () => snapshotWorker(worker)).catch(() => {
        void markWorkerUnusable(worker).catch(() => {})
      })
    })
    worker.watcher.on('error', () => { void markWorkerUnusable(worker).catch(() => {}) })
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
  await rm(snapshotPath(worker.identity), { force: true })
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

export async function snapshotWorker(worker) {
  if (worker.closed) return
  try {
    const authFiles = {}
    if (worker.status !== 'pending') {
      const names = await readdir(worker.authDir)
      for (const name of names) {
        if ((name.startsWith('.oauth-') && name.endsWith('.oauth')) ||
            name.startsWith('.oauth-callback-')) continue
        if (Buffer.byteLength(name) > 255 || !/^[A-Za-z0-9@._+-]{1,251}\.json$/.test(name) ||
            name === '.json' || name !== path.basename(name)) {
          throw new Error('Unexpected subscription auth file')
        }
        authFiles[name] = await readStableAuthFile(path.join(worker.authDir, name), worker.providerId)
      }
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

async function readStableAuthFile(filePath, providerId) {
  let previousContents
  let previousStat
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const before = await lstat(filePath)
      if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > 2_000_000) {
        throw new Error('Unreadable subscription auth file')
      }
      const contents = await readFile(filePath, 'utf8')
      const after = await lstat(filePath)
      const parsed = JSON.parse(contents)
      if (!after.isFile() || after.isSymbolicLink() || after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs || Buffer.byteLength(contents) !== after.size ||
          !parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
          !providerTypes(providerId).has(parsed.type) || !hasCredentialValue(providerId, parsed)) {
        throw new Error('Subscription auth file is not stable')
      }
      if (contents === previousContents && after.size === previousStat?.size &&
          after.mtimeMs === previousStat?.mtimeMs && after.ino === previousStat?.ino) {
        return contents
      }
      previousContents = contents
      previousStat = after
    } catch {
      previousContents = undefined
      previousStat = undefined
    }
    if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Subscription auth file did not stabilize')
}

export async function management(worker, pathname, options = {}) {
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

export async function providerCall(record, pathName, body, signal) {
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

export async function stopWorker(worker, { removeSnapshot = true } = {}) {
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

export async function shutdownWorkers() {
  await Promise.all([...workers.values()].map(async (worker) => {
    await withLock(worker.identity, async () => {
      try { await snapshotWorker(worker) } catch { worker.status = 'error' }
      await stopWorker(worker, { removeSnapshot: false }).catch(() => {})
    })
  }))
}

export async function disconnect(body) {
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
            info.size > 3_000_000) {
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
