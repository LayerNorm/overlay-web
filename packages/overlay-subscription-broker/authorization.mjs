import { randomBytes } from 'node:crypto'
import {
  MAX_WORKERS,
  assertEnabledProvider,
  keyFor,
  now,
  subscriptionError,
  workers,
  withLock,
} from './state.mjs'
import { validAuthorizationUrl } from './request-validation.mjs'
import { startWorker, management, snapshotWorker, stopWorker } from './worker-lifecycle.mjs'

export async function startAuthorization(body) {
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
    try {
      const auth = await management(worker, `/v8/management/oauth/auth-url?provider=${encodeURIComponent(providerId)}`)
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

export async function pollAuthorization(body) {
  const identity = keyFor(body.ownerId, body.connectionId)
  return await withLock(identity, async () => {
    const worker = workers.get(identity)
    if (!worker || worker.providerId !== body.providerId) {
      throw subscriptionError(404, 'Subscription authorization not found')
    }
    if (worker.status === 'connected') return await connectedResult(worker)
    if (worker.authExpiresAt && worker.authExpiresAt <= now()) {
      await stopWorker(worker)
      return { status: 'expired' }
    }
    const status = await management(worker,
      `/v8/management/oauth/status?state=${encodeURIComponent(worker.oauthState ?? '')}`)
    if (status.status === 'wait') return { status: 'pending' }
    if (status.status !== 'ok') {
      return { status: 'error', error: 'Authorization was rejected. Start again.' }
    }
    worker.status = 'connected'
    let discovered
    try {
      discovered = await discoverModels(worker)
    } catch {
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

export async function callbackAuthorization(body) {
  const identity = keyFor(body.ownerId, body.connectionId)
  return await withLock(identity, async () => {
    const worker = workers.get(identity)
    if (!worker || worker.providerId !== 'devin' || typeof body.callbackUrl !== 'string') {
      throw subscriptionError(404, 'Subscription authorization not found')
    }
    let callback
    try { callback = new URL(body.callbackUrl) } catch {
      throw subscriptionError(400, 'Invalid authorization callback')
    }
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

export async function discoverModels(worker) {
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
    .map((model) => ({
      id: model.id,
      name: typeof model.display_name === 'string' ? model.display_name.slice(0, 200) : model.id,
    }))
}

export async function connectedResult(worker) {
  await snapshotWorker(worker)
  return { status: 'connected', models: worker.discoveredModels }
}

export async function refreshAuthorization(body) {
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

export async function setModels(body) {
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
