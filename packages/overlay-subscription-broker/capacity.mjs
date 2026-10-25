import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { MAX_WORKERS, now, subscriptionError, workers, withLock } from './state.mjs'
import { decrypt, stateRoot } from './persistence.mjs'
import { validateRecord } from './record-validation.mjs'

const SNAPSHOT_FILE = /^[a-f0-9]{64}\.enc$/
const SNAPSHOT_TEMP_FILE = /^[a-f0-9]{64}\.enc\.[a-f0-9]{16}\.tmp$/
const SNAPSHOT_BACKUP_FILE = /^[a-f0-9]{64}\.enc\.bak$/
const MAX_SNAPSHOT_BYTES = 3_000_000

export async function withAuthorizationCapacity(identity, operation) {
  return await withLock('subscription-capacity', async () => {
    const occupied = await pendingCodexIdentities()
    for (const key of workers.keys()) occupied.add(key)
    if (occupied.size >= MAX_WORKERS && !occupied.has(identity)) {
      throw subscriptionError(503, 'Subscription capacity is full')
    }
    return await operation()
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

