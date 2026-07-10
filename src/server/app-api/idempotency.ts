import 'server-only'

import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { logSecurityEvent } from '@/server/observability/security-events'
import type {
  CachedIdempotencyHeader,
  IdempotencyRepository,
  IdempotencyReservationResult,
} from '@/server/idempotency'
import { isStreamIdempotencyMarker } from '@/shared/api/idempotency-markers'

const MUTATION_METHODS = new Set(['POST', 'PATCH', 'DELETE'])
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000
const MAX_IDEMPOTENCY_KEY_LENGTH = 255
const MAX_CACHED_RESPONSE_BYTES = 512 * 1024
const STREAM_IDEMPOTENCY_PATHS = new Set([
  '/api/v1/conversations/act',
  '/api/v1/conversations/act/extension-plan',
])

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
])

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeIdempotencyKey(value: string | null): string | null {
  const key = value?.trim()
  if (!key) return null
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) return null
  return key
}

function keyHashFor(args: {
  key: string
  method: string
  pathname: string
  userId: string
}): string {
  return sha256(`${args.userId}\n${args.method.toUpperCase()}\n${args.pathname}\n${args.key}`)
}

async function requestHashFor(request: NextRequest): Promise<string> {
  const body = await request.clone().arrayBuffer().catch((_error) => new ArrayBuffer(0))
  const bodyHash = sha256(Buffer.from(body))
  return sha256(`${request.method.toUpperCase()}\n${request.nextUrl.pathname}\n${request.nextUrl.search}\n${bodyHash}`)
}

function cachedResponseToResponse(result: IdempotencyReservationResult): Response {
  const headers = new Headers()
  for (const header of result.responseHeaders ?? []) {
    if (header.name && header.value) headers.set(header.name, header.value)
  }
  headers.set('Idempotency-Replayed', 'true')
  headers.set('Idempotency-Status', 'replayed')
  return new Response(result.responseBody ?? '', {
    status: result.responseStatus ?? 200,
    headers,
  })
}

async function cacheableResponsePayload(response: Response): Promise<{
  body: string
  headers: CachedIdempotencyHeader[]
  status: number
} | null> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return null

  const body = await response.clone().text().catch((_error) => null)
  if (body == null) return null
  if (new TextEncoder().encode(body).byteLength > MAX_CACHED_RESPONSE_BYTES) return null

  const headers: CachedIdempotencyHeader[] = []
  response.headers.forEach((value, name) => {
    const lowerName = name.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(lowerName)) return
    if (value.length > 8_192) return
    headers.push({ name, value })
  })

  return {
    body,
    headers,
    status: response.status,
  }
}

function isStreamIdempotencyPath(pathname: string): boolean {
  return STREAM_IDEMPOTENCY_PATHS.has(pathname)
}

async function completeStreamStartedReservation(
  repository: IdempotencyRepository,
  keyHash: string,
  requestHash: string,
): Promise<void> {
  await repository.completeStreamStarted({ keyHash, requestHash }).catch((error) => {
    logSecurityEvent(
      'api_idempotency_stream_complete_failed',
      { reason: error instanceof Error ? error.message : String(error) },
      'warning',
    )
  })
}

async function discardReservation(
  repository: IdempotencyRepository,
  keyHash: string,
  requestHash: string,
): Promise<void> {
  await repository.discard({ keyHash, requestHash }).catch((error) => {
    logSecurityEvent(
      'api_idempotency_discard_failed',
      { reason: error instanceof Error ? error.message : String(error) },
      'warning',
    )
  })
}

export async function handleIdempotentMutation(
  request: NextRequest,
  userId: string,
  run: () => Promise<Response>,
  options: {
    repository: IdempotencyRepository
  },
): Promise<Response> {
  const method = request.method.toUpperCase()
  if (!MUTATION_METHODS.has(method)) return run()

  const key = normalizeIdempotencyKey(request.headers.get('idempotency-key'))
  if (!key) {
    if (request.headers.has('idempotency-key')) {
      return NextResponse.json({ error: 'Invalid Idempotency-Key header' }, { status: 400 })
    }
    return run()
  }

  const keyHash = keyHashFor({
    key,
    method,
    pathname: request.nextUrl.pathname,
    userId,
  })
  const requestHash = await requestHashFor(request)
  const reservation = await options.repository.reserve({
      userId,
      keyHash,
      requestHash,
      method,
      path: request.nextUrl.pathname,
      expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
  }).catch((error) => {
    logSecurityEvent(
      'api_idempotency_reserve_failed',
      { reason: error instanceof Error ? error.message : String(error) },
      'warning',
    )
    return null
  })
  if (!reservation) {
    return NextResponse.json({ error: 'Idempotency reservation failed' }, { status: 503 })
  }

  if (reservation.status === 'replay') {
    if (isStreamIdempotencyMarker(reservation.responseBody)) {
      return NextResponse.json(
        {
          error: 'Stream already started for this Idempotency-Key',
          code: 'stream_already_started',
        },
        { status: 409 },
      )
    }
    return cachedResponseToResponse(reservation)
  }
  if (reservation.status === 'conflict') {
    return NextResponse.json(
      { error: 'Idempotency-Key was already used for a different request' },
      { status: 409 },
    )
  }
  if (reservation.status === 'in_flight') {
    return NextResponse.json(
      { error: 'Idempotency-Key request is still processing' },
      { status: 409, headers: { 'Retry-After': '2' } },
    )
  }

  let response: Response
  try {
    response = await run()
  } catch (error) {
    await discardReservation(options.repository, keyHash, requestHash)
    throw error
  }

  const payload = await cacheableResponsePayload(response)
  if (!payload) {
    if (
      isStreamIdempotencyPath(request.nextUrl.pathname) &&
      response.ok
    ) {
      await completeStreamStartedReservation(options.repository, keyHash, requestHash)
      const headers = new Headers(response.headers)
      headers.set('Idempotency-Status', 'stream-started')
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }
    await discardReservation(options.repository, keyHash, requestHash)
    return response
  }

  const completion = await options.repository.complete({
      keyHash,
      requestHash,
      responseStatus: payload.status,
      responseHeaders: payload.headers,
      responseBody: payload.body,
  }).catch((error) => {
    logSecurityEvent(
      'api_idempotency_complete_failed',
      { reason: error instanceof Error ? error.message : String(error) },
      'warning',
    )
    return null
  })
  if (!completion) return response

  const headers = new Headers(response.headers)
  headers.set('Idempotency-Status', 'stored')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
