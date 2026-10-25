import {
  keyFor,
  providerEnabled,
  subscriptionError,
  validConnectionId,
  validOwnerId,
  workers,
  withLock,
} from './state.mjs'
import {
  assertOverlayTools,
  assertSupportedSubscriptionRequest,
  readJson,
} from './request-validation.mjs'
import { snapshotWorker } from './worker-lifecycle.mjs'

export async function inference(request, response, pathname) {
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
    assertOverlayTools(body, pathname)
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
      await proxyInference(worker, body, pathname, response, controller.signal)
    })
  } finally {
    request.off('aborted', abort)
  }
}

async function proxyInference(worker, body, pathname, response, signal) {
  let upstream
  try {
    upstream = await fetch(`http://127.0.0.1:${worker.port}${pathname}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${worker.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
      redirect: 'error',
    })
  } catch (error) {
    await snapshotWorker(worker)
    throw error
  }
  if (!upstream.ok) {
    await handleUpstreamError(upstream, worker, response)
    return
  }
  if (!response.headersSent) {
    response.writeHead(upstream.status, Object.fromEntries(
      [...upstream.headers].filter(([name]) =>
        ['content-type', 'cache-control', 'x-request-id'].includes(name.toLowerCase())),
    ))
  }
  if (upstream.body) await streamUpstream(upstream, worker, response, signal)
  await snapshotWorker(worker)
  if (!response.writableEnded && !signal.aborted) response.end()
}

async function handleUpstreamError(upstream, worker, response) {
  await upstream.body?.cancel().catch(() => undefined)
  await snapshotWorker(worker)
  if (!response.headersSent && !response.destroyed) {
    response.writeHead(upstream.status >= 500 ? 502 : upstream.status, {
      'content-type': 'application/json', 'cache-control': 'no-store',
    }).end(JSON.stringify({
      error: 'Upstream provider request failed',
      category: 'subscription_upstream_error',
    }))
  }
}

async function streamUpstream(upstream, worker, response, signal) {
  try {
    for await (const chunk of upstream.body) {
      if (!response.write(chunk)) await waitForWritable(response, signal)
    }
  } catch (error) {
    await snapshotWorker(worker)
    if (response.headersSent) response.destroy()
    throw error
  }
}

function waitForWritable(response, signal) {
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve() }
    const fail = () => { cleanup(); reject(new Error('Client disconnected')) }
    const cleanup = () => {
      response.off('drain', done)
      response.off('close', fail)
      response.off('error', fail)
      signal.removeEventListener('abort', fail)
    }
    response.once('drain', done)
    response.once('close', fail)
    response.once('error', fail)
    signal.addEventListener('abort', fail, { once: true })
    if (signal.aborted || response.destroyed || response.writableEnded) fail()
    else if (!response.writableNeedDrain) done()
  })
}
