import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { MAX_WORKERS, keyFor, now, workers, withLock } from './state.mjs'
import { validateRecord } from './record-validation.mjs'

const SNAPSHOT_VERSION = 1
const SNAPSHOT_FILE = /^[a-f0-9]{64}\.enc$/
const SNAPSHOT_TEMP_FILE = /^[a-f0-9]{64}\.enc\.[a-f0-9]{16}\.tmp$/
const SNAPSHOT_BACKUP_FILE = /^[a-f0-9]{64}\.enc\.bak$/
const MAX_SNAPSHOT_BYTES = 3_000_000
let singletonLock = null

function masterKey() {
  const value = process.env.OVERLAY_SUBSCRIPTION_MASTER_KEY ?? ''
  const key = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64')
  if (key.length !== 32) throw new Error('OVERLAY_SUBSCRIPTION_MASTER_KEY must encode 32 bytes')
  return key
}

export function validateMasterKey() {
  masterKey()
}

export function encrypt(value, aad) {
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

export function decrypt(serialized, aad) {
  const envelope = JSON.parse(serialized)
  if (envelope.version !== SNAPSHOT_VERSION) throw new Error('Invalid encrypted snapshot')
  const decipher = createDecipheriv(
    'aes-256-gcm',
    masterKey(),
    Buffer.from(envelope.iv, 'base64'),
    { authTagLength: 16 },
  )
  decipher.setAAD(Buffer.from(aad))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString())
}

export function runtimeRoot() {
  return process.env.OVERLAY_SUBSCRIPTION_RUNTIME_DIR ?? '/run/overlay-subscription-broker'
}

export function stateRoot() {
  return process.env.OVERLAY_SUBSCRIPTION_STATE_DIR ?? '/var/lib/overlay-subscription-broker'
}

export function snapshotPath(identity) {
  return path.join(stateRoot(), `${identity}.enc`)
}

export async function acquireSingletonLock() {
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

export async function releaseSingletonLock() {
  const handle = singletonLock
  singletonLock = null
  if (!handle) return
  const lockPath = path.join(stateRoot(), '.broker.lock')
  await handle.close()
  await rm(lockPath, { force: true })
}

export async function atomicSnapshot(record) {
  const identity = keyFor(record.ownerId, record.connectionId)
  const target = snapshotPath(identity)
  const temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`
  const backup = `${target}.bak`
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  const previous = await preservePreviousSnapshot(target, backup)
  const handle = await open(temporary, 'wx', 0o600)
  let renamed = false
  try {
    await handle.writeFile(encrypt(record, `overlay-subscription:${identity}`))
    await handle.sync()
    await handle.close()
    await rename(temporary, target)
    renamed = true
    await syncDirectory(path.dirname(target))
    if (previous.hasBackup) {
      await rm(backup)
      await syncDirectory(path.dirname(target))
    }
  } catch (error) {
    await rollbackSnapshot({ target, backup, previous, renamed })
    throw error
  } finally {
    await handle.close().catch(() => {})
    if (!renamed) await rm(temporary, { force: true }).catch(() => {})
  }
}

async function preservePreviousSnapshot(target, backup) {
  let snapshot
  try {
    const info = await lstat(target)
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 ||
        info.size > MAX_SNAPSHOT_BYTES) throw new Error('Unreadable encrypted subscription state')
    snapshot = await readFile(target)
    const handle = await open(backup, 'wx', 0o600)
    try {
      await handle.writeFile(snapshot)
      await handle.sync()
    } finally {
      await handle.close()
    }
    return { hasBackup: true, snapshot }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return { hasBackup: false }
  }
}

async function rollbackSnapshot({ target, backup, previous, renamed }) {
  if (previous.hasBackup) {
    await rename(backup, target).catch(() => {})
  } else if (renamed && previous.snapshot) {
    await restoreSnapshotBytes(target, previous.snapshot)
  } else if (renamed) {
    await rm(target, { force: true }).catch(() => {})
  }
  await syncDirectory(path.dirname(target)).catch(() => {})
}

async function restoreSnapshotBytes(target, contents) {
  const rollback = `${target}.${randomBytes(8).toString('hex')}.tmp`
  try {
    const handle = await open(rollback, 'wx', 0o600)
    try {
      await handle.writeFile(contents)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(rollback, target)
  } catch {
    await rm(rollback, { force: true }).catch(() => {})
  }
}

async function syncDirectory(directoryPath) {
  const directory = await open(directoryPath, 'r')
  try { await directory.sync() } finally { await directory.close() }
}

export async function restoreRecords({ startWorker, snapshotWorker, stopWorker }) {
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
    for (const file of files) await restoreRecordFile(file, { startWorker, snapshotWorker })
  } catch (error) {
    await Promise.all([...workers.values()].map((worker) =>
      stopWorker(worker, { removeSnapshot: false })))
    throw error
  }
}

async function restoreRecordFile(file, { startWorker, snapshotWorker }) {
  if (file === '.broker.lock') return
  if (SNAPSHOT_BACKUP_FILE.test(file)) return await restoreBackupFile(file)
  if (SNAPSHOT_TEMP_FILE.test(file)) return await removeTemporaryFile(file)
  if (!SNAPSHOT_FILE.test(file)) throw new Error('Unexpected subscription state file')
  const { record, identity } = await readSnapshotRecord(file)
  if (record.status !== 'connected') return
  if (workers.size >= MAX_WORKERS) {
    throw new Error('Recovered subscription state exceeds the configured worker limit')
  }
  const worker = await startWorker(record)
  workers.set(identity, worker)
  await snapshotWorker(worker)
}

async function restoreBackupFile(file) {
  const backupPath = path.join(stateRoot(), file)
  const info = await lstat(backupPath)
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 ||
      info.size > MAX_SNAPSHOT_BYTES) throw new Error('Unreadable encrypted subscription state backup')
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
}

async function removeTemporaryFile(file) {
  const temporaryPath = path.join(stateRoot(), file)
  const info = await lstat(temporaryPath)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unexpected subscription state file')
  await rm(temporaryPath, { force: true })
}

async function readSnapshotRecord(file) {
  const filePath = path.join(stateRoot(), file)
  const info = await lstat(filePath)
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 ||
      info.size > MAX_SNAPSHOT_BYTES) throw new Error('Unreadable encrypted subscription state')
  const identity = file.slice(0, -4)
  let record
  try {
    record = decrypt(await readFile(filePath, 'utf8'), `overlay-subscription:${identity}`)
  } catch {
    throw new Error('Encrypted subscription state is corrupt; refusing to start')
  }
  validateRecord(record, identity)
  return { record, identity }
}

export async function reapExpiredState({ stopWorker }) {
  const timestamp = now()
  for (const worker of [...workers.values()]) {
    if (isExpiredWorker(worker, timestamp)) {
      await withLock(worker.identity, async () => {
        if (workers.get(worker.identity) === worker) await stopWorker(worker)
      }).catch(() => {})
    }
  }
  let files = []
  try { files = await readdir(stateRoot()) } catch { return }
  for (const file of files) await reapExpiredSnapshot(file, timestamp)
}

function isExpiredWorker(worker, timestamp) {
  return (worker.status === 'pending' || worker.status === 'error') &&
    ((worker.authExpiresAt && worker.authExpiresAt <= timestamp) ||
     (worker.codexDeviceCode?.expiresAt && worker.codexDeviceCode.expiresAt <= timestamp))
}

async function reapExpiredSnapshot(file, timestamp) {
  if (!file.endsWith('.enc')) return
  const identity = file.slice(0, -4)
  if (workers.has(identity)) return
  try {
    const record = decrypt(await readFile(path.join(stateRoot(), file), 'utf8'),
      `overlay-subscription:${identity}`)
    const expiresAt = record.authExpiresAt ?? record.codexDeviceCode?.expiresAt
    if ((record.status === 'pending' || record.status === 'error') && expiresAt &&
        expiresAt <= timestamp) await rm(path.join(stateRoot(), file), { force: true })
  } catch {
    // Corrupt state is retained for operator recovery and prevents reuse.
  }
}
