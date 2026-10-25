import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import {
  MAX_WORKERS,
  constantTimeSecret,
  keyFor,
  now,
  providerEnabled,
  subscriptionError,
  workers,
  withLock,
} from './state.mjs'
import {
  atomicSnapshot,
  decrypt,
  snapshotPath,
} from './persistence.mjs'
import { validateRecord } from './record-validation.mjs'
import { withAuthorizationCapacity } from './capacity.mjs'
import { connectedResult, discoverModels } from './authorization.mjs'
import { management, snapshotWorker, startWorker, stopWorker } from './worker-lifecycle.mjs'


export async function startCodexAuthorization(body) {
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
  return await withAuthorizationCapacity(identity, async () => {
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


export async function getCodexDeviceCode(body) {
  const identity = keyFor(body.ownerId, body.connectionId)
  return await withLock(identity, async () => {
    const record = await readCodexRecord(identity, { missingStatus: 404 })
    assertCodexOwner(record, body)
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
    if (record.codexPollLease?.expiresAt > now()) return { status: 'polling' }
    const lease = { token: randomBytes(32).toString('base64url'), expiresAt: now() + 20_000 }
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

export async function releaseCodexPoll(body) {
  const identity = keyFor(body.ownerId, body.connectionId)
  return await withLock(identity, async () => {
    let record
    try {
      record = await readCodexRecord(identity, { missingStatus: 404 })
    } catch (error) {
      if (error?.status === 404) return { released: false }
      throw error
    }
    if (!matchesPollLease(record, body)) return { released: false }
    record.codexPollLease = null
    await atomicSnapshot(record)
    return { released: true }
  })
}

async function readCodexRecord(identity, { missingStatus }) {
  let serialized
  try {
    serialized = await readFile(snapshotPath(identity), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      if (missingStatus === 404) throw subscriptionError(404, 'Codex authorization not found')
      throw subscriptionError(503, 'Codex authorization state is unavailable')
    }
    throw subscriptionError(503, 'Codex authorization state is unavailable')
  }
  let record
  try {
    record = decrypt(serialized, `overlay-subscription:${identity}`)
  } catch {
    throw subscriptionError(503, 'Codex authorization state is unavailable')
  }
  validateRecord(record, identity)
  return record
}

function assertCodexOwner(record, body) {
  if (record.ownerId !== body.ownerId || record.connectionId !== body.connectionId ||
      record.providerId !== 'codex') {
    throw subscriptionError(404, 'Codex authorization not found')
  }
}

function matchesPollLease(record, body) {
  return record.ownerId === body.ownerId && record.connectionId === body.connectionId &&
    record.providerId === 'codex' && record.status !== 'connected' &&
    typeof body.authorizationGeneration === 'string' &&
    body.authorizationGeneration === record.authorizationGeneration &&
    record.codexPollLease && typeof body.pollLease === 'string' &&
    record.codexPollLease.expiresAt > now() &&
    constantTimeSecret(record.codexPollLease.token, body.pollLease)
}

export async function importCodex(body) {
  const identity = keyFor(body.ownerId, body.connectionId)
  return await withAuthorizationCapacity(identity, () => withLock(identity, async () => {
    let worker = workers.get(identity)
    if (worker && (worker.providerId !== 'codex' || worker.status !== 'pending')) {
      throw subscriptionError(403, 'Codex authorization is not pending')
    }
    const pending = await readCodexRecord(identity, { missingStatus: 404 })
    if (!validImportLease(pending, body)) {
      throw subscriptionError(403, 'Codex authorization lease is stale')
    }
    if (!worker) {
      if (workers.size >= MAX_WORKERS) throw subscriptionError(503, 'Subscription capacity is full')
      worker = await startWorker(createPendingWorkerRecord(body, pending))
      workers.set(identity, worker)
    }
    return await importCodexTokens(worker, body)
  }))
}

function validImportLease(pending, body) {
  return pending.ownerId === body.ownerId && pending.connectionId === body.connectionId &&
    pending.providerId === 'codex' && pending.status === 'pending' &&
    typeof body.authorizationGeneration === 'string' &&
    body.authorizationGeneration === pending.authorizationGeneration &&
    typeof body.pollLease === 'string' && pending.codexPollLease &&
    constantTimeSecret(pending.codexPollLease.token, body.pollLease) &&
    pending.codexPollLease.expiresAt > now()
}

function createPendingWorkerRecord(body, pending) {
  return {
    ownerId: body.ownerId, connectionId: body.connectionId, providerId: 'codex',
    status: 'pending', apiKey: randomBytes(32).toString('base64url'),
    managementKey: randomBytes(32).toString('base64url'), enabledModelIds: [],
    discoveredModels: [], authFiles: {}, codexDeviceCode: pending.codexDeviceCode,
    authorizationGeneration: pending.authorizationGeneration,
    codexPollLease: pending.codexPollLease,
  }
}

async function importCodexTokens(worker, body) {
  const token = body.tokens
  if (!isTokenSet(token)) throw subscriptionError(400, 'Codex authorization token is invalid')
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
}

function isTokenSet(value) {
  return Boolean(value && typeof value === 'object' &&
    ['idToken', 'accessToken', 'refreshToken'].every((key) =>
      typeof value[key] === 'string' && value[key].length > 20) &&
    typeof value.lastRefresh === 'number' && Number.isFinite(value.lastRefresh) &&
    typeof value.accountId === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value.accountId))
}
