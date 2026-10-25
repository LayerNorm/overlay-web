import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  configuredProviders,
  constantTimeSecret,
  serializeError,
  setClock,
} from './state.mjs'
import { readJson } from './request-validation.mjs'
import {
  acquireSingletonLock,
  reapExpiredState,
  releaseSingletonLock,
  restoreRecords,
  validateMasterKey,
} from './persistence.mjs'
import { shutdownWorkers, snapshotWorker, startWorker, stopWorker } from './worker-lifecycle.mjs'
import { handleManagement } from './management-dispatch.mjs'
import { inference } from './inference.mjs'

export async function createBrokerServer(options = {}) {
  setClock(typeof options.now === 'function' ? options.now : () => Date.now())
  const serviceKey = options.serviceKey ?? process.env.OVERLAY_SUBSCRIPTION_BROKER_KEY ?? ''
  if (Buffer.byteLength(serviceKey) < 32) {
    throw new Error('OVERLAY_SUBSCRIPTION_BROKER_KEY must be at least 32 bytes')
  }
  validateMasterKey()
  await acquireSingletonLock()
  try {
    await restoreRecords({ startWorker, snapshotWorker, stopWorker })
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
        response.writeHead(200, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        }).end(JSON.stringify({
          status: 'ok',
          capabilities: {
            protocols: ['chat', 'responses'],
            providers: [...configuredProviders('OVERLAY_SUBSCRIPTION_BROKER_ENABLED_PROVIDERS')],
          },
        }))
        return
      }
      const pathname = new URL(request.url, 'http://localhost').pathname
      if (request.method === 'POST' &&
          ['/v1/chat/completions', '/v1/responses'].includes(pathname)) {
        await inference(request, response, pathname)
        return
      }
      if (request.method === 'POST' && pathname.startsWith('/v1/subscriptions/')) {
        const body = await readJson(request)
        const result = await handleManagement(pathname, body)
        response.writeHead(200, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        }).end(JSON.stringify(result))
        return
      }
      response.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"Not found"}')
    } catch (error) {
      const result = serializeError(error)
      if (response.headersSent) {
        response.destroy()
      } else {
        response.writeHead(result.status, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        }).end(JSON.stringify(result.body))
      }
    }
  })
  const host = options.host ?? process.env.OVERLAY_SUBSCRIPTION_BROKER_HOST ?? '127.0.0.1'
  const port = options.port ?? Number(process.env.PORT ?? 8088)
  server.listen(port, host)
  const reaper = setInterval(() => { void reapExpiredState({ stopWorker }) }, 30_000)
  reaper.unref?.()
  server.shutdown = async () => {
    clearInterval(reaper)
    await new Promise((resolve) => server.close(() => resolve()))
    await shutdownWorkers()
    await releaseSingletonLock()
    setClock(() => Date.now())
  }
  return server
}

export { assertSupportedSubscriptionRequest, validAuthorizationUrl } from './request-validation.mjs'
export { PROVIDERS, constantTimeSecret, keyFor } from './state.mjs'
export { decrypt, encrypt } from './persistence.mjs'

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
