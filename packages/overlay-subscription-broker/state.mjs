import { createHash, timingSafeEqual } from 'node:crypto'
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

export const ROOT = path.dirname(fileURLToPath(import.meta.url))
export const MAX_WORKERS = Math.min(128, Math.max(1, Number(process.env.OVERLAY_SUBSCRIPTION_MAX_WORKERS) || 128))
export const locks = new Map()
export const workers = new Map()

let clock = () => Date.now()

export const now = () => clock()

export function setClock(nextClock) {
  clock = nextClock
}

export function keyFor(ownerId, connectionId) {
  return createHash('sha256').update(`${ownerId}\0${connectionId}`).digest('hex')
}

export function knownProvider(providerId) {
  return Object.hasOwn(PROVIDERS, providerId)
}

export function configuredProviders(envName) {
  const configured = (process.env[envName] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return new Set(configured.filter(knownProvider))
}

export function providerEnabled(providerId) {
  return configuredProviders('OVERLAY_SUBSCRIPTION_BROKER_ENABLED_PROVIDERS').has(providerId)
}

export function assertEnabledProvider(providerId) {
  if (!knownProvider(providerId) || !providerEnabled(providerId)) {
    throw subscriptionError(400, 'This subscription provider is not enabled in this deployment')
  }
}

export function validOwnerId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
}

export function validConnectionId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
}

export function constantTimeSecret(expected, supplied) {
  if (typeof supplied !== 'string') return false
  const left = Buffer.from(expected)
  const right = Buffer.from(supplied)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function sanitizedError(error) {
  const text = String(error?.message ?? '').toLowerCase()
  if (text.includes('expired') || text.includes('timeout')) return 'Authorization expired. Start again.'
  if (text.includes('unauthorized') || text.includes('invalid_grant')) return 'Authorization was rejected. Reconnect the account.'
  return 'The subscription service could not complete this request. Try again.'
}

export function subscriptionError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

export function serializeError(error) {
  return {
    status: Number.isInteger(error?.status) ? error.status : 500,
    body: { error: sanitizedError(error), category: 'subscription_unavailable' },
  }
}

export async function withLock(key, operation) {
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
