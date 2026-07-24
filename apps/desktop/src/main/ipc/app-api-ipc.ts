import { ipcMain } from '../services/security/secure-ipc-main'
import { keyCacheService } from '../services/key-cache-service'
import { safeStorageService } from '../services/security/safe-storage-service'
import { validateSender } from '../utils/ipc-security'
import { serverProfileService } from '../services/security/server-profile-service'
import { assertPublicHttpsDestination } from '../services/security/network-destination-policy'
import {
  appApiPathForLog,
  headersToRecord,
  isBinaryContentPath,
  normalizeAppApiInput,
  sanitizeForwardedHeaders,
  shouldProbeLegacyBearerUserId,
  shouldRecoverAppApiAuthentication,
  type AppApiRequestInput,
  type NormalizedAppApiRequest
} from './app-api-security'

interface AppApiRequestResult {
  ok: boolean
  status: number
  statusText: string
  bodyText: string
  bodyBase64?: string
  headers?: Record<string, string>
}

interface AppApiStreamInput extends AppApiRequestInput {
  streamId: string
}

const activeStreams = new Map<string, { senderId: number; controller: AbortController }>()
const legacyBearerUserIdOrigins = new Set<string>()

export function registerAppApiIPC(): void {
  ipcMain.handle(
    'storage:upload',
    async (
      event,
      input: { url: string; contentType: string; data: ArrayBuffer }
    ): Promise<{ ok: boolean; status: number }> => {
      validateSender(event, 'storage:upload')
      if (
        !input ||
        typeof input.contentType !== 'string' ||
        input.contentType.length > 256 ||
        !(input.data instanceof ArrayBuffer) ||
        input.data.byteLength > 50 * 1024 * 1024
      ) {
        throw new Error('invalid_storage_upload')
      }
      let destination = await assertPublicHttpsDestination(input.url)
      for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
        const response = await fetch(destination, {
          method: 'PUT',
          headers: { 'Content-Type': input.contentType || 'application/octet-stream' },
          body: Buffer.from(input.data),
          redirect: 'manual'
        })
        if (![301, 302, 303, 307, 308].includes(response.status)) {
          return { ok: response.ok, status: response.status }
        }
        const location = response.headers.get('location')
        if (!location || redirectCount === 3) throw new Error('storage_upload_redirect_rejected')
        destination = await assertPublicHttpsDestination(new URL(location, destination).toString())
      }
      throw new Error('storage_upload_redirect_rejected')
    }
  )

  ipcMain.handle(
    'app-api:request',
    async (event, input: AppApiRequestInput): Promise<AppApiRequestResult> => {
      validateSender(event, 'app-api:request')

      const request = normalizeAppApiInput(input)
      const session = safeStorageService.getAuthSession()
      const userId = session?.user?.id?.trim()
      let accessToken = keyCacheService.getAccessToken() || session?.accessToken?.trim() || null
      const logPath = appApiPathForLog(request.path)

      console.log(`[AppApiIPC] ${request.method} ${logPath}`)

      if (!userId || !accessToken) {
        return {
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          bodyText: JSON.stringify({ error: 'Not authenticated' })
        }
      }

      let response: Response
      try {
        const serverOrigin = serverProfileService.getActiveOrigin()
        const useLegacyUserId = legacyBearerUserIdOrigins.has(serverOrigin)
        response = await fetchAppApi(
          request,
          accessToken,
          undefined,
          useLegacyUserId ? userId : undefined
        )
        if (!useLegacyUserId && shouldProbeLegacyBearerUserId(request.path, response)) {
          const compatibilityResponse = await fetchAppApi(
            request,
            accessToken,
            undefined,
            userId
          )
          if (compatibilityResponse.ok) {
            legacyBearerUserIdOrigins.add(serverOrigin)
            console.warn(
              '[AppApiIPC] Server uses the legacy bearer-plus-user-id contract; compatibility mode enabled for this process'
            )
          }
          response = compatibilityResponse
        }
        const shouldRecover = shouldRecoverAppApiAuthentication(response)
        if (
          shouldRecover &&
          (await keyCacheService.recoverAccessTokenAfterUnauthorized(accessToken))
        ) {
          accessToken =
            keyCacheService.getAccessToken() ||
            safeStorageService.getAuthSession()?.accessToken ||
            null
          if (accessToken) {
            response = await fetchAppApi(
              request,
              accessToken,
              undefined,
              legacyBearerUserIdOrigins.has(serverOrigin) ? userId : undefined
            )
          }
        }
        if (shouldRecover && shouldRecoverAppApiAuthentication(response)) {
          keyCacheService.forceSignOutForInvalidSession()
        }
        if (response.status !== 401 && accessToken) {
          keyCacheService.markAccessTokenAccepted(accessToken)
        }
      } catch {
        const message = 'Network request failed'
        console.error(`[AppApiIPC] ${request.method} ${logPath} failed`)
        return {
          ok: false,
          status: 0,
          statusText: 'Network Error',
          bodyText: JSON.stringify({ error: message })
        }
      }

      const headers = headersToRecord(response.headers)
      const binaryBody = response.ok && isBinaryContentPath(request.path)
      const bodyBase64 = binaryBody
        ? Buffer.from(await response.arrayBuffer()).toString('base64')
        : undefined
      const bodyText = binaryBody ? '' : await response.text().catch(() => '')
      if (!response.ok) {
        console.error(
          `[AppApiIPC] ${request.method} ${logPath} failed (${response.status})`
        )
      }

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        bodyText,
        ...(bodyBase64 ? { bodyBase64 } : {}),
        headers
      }
    }
  )

  ipcMain.handle(
    'app-api:stream',
    async (event, input: AppApiStreamInput): Promise<AppApiRequestResult> => {
      validateSender(event, 'app-api:stream')

      const streamId = typeof input?.streamId === 'string' ? input.streamId.trim() : ''
      if (!streamId) {
        throw new Error('Invalid app API stream id')
      }

      const request = normalizeAppApiInput(input, { stream: true })
      const logPath = appApiPathForLog(request.path)
      if (activeStreams.has(streamId)) {
        throw new Error('Duplicate app API stream id')
      }
      const controller = new AbortController()
      activeStreams.set(streamId, { senderId: event.sender.id, controller })
      const session = safeStorageService.getAuthSession()
      const userId = session?.user?.id?.trim()
      let accessToken = keyCacheService.getAccessToken() || session?.accessToken?.trim() || null

      if (!userId || !accessToken) {
        const result = {
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          bodyText: JSON.stringify({ error: 'Not authenticated' })
        }
        event.sender.send('app-api:stream-event', {
          streamId,
          type: 'ready',
          status: result.status,
          statusText: result.statusText,
          headers: { 'content-type': 'application/json' }
        })
        event.sender.send('app-api:stream-event', {
          streamId,
          type: 'chunk',
          chunk: result.bodyText
        })
        event.sender.send('app-api:stream-event', { streamId, type: 'done' })
        activeStreams.delete(streamId)
        return result
      }

      try {
        const serverOrigin = serverProfileService.getActiveOrigin()
        let response = await fetchAppApi(
          request,
          accessToken,
          controller.signal,
          legacyBearerUserIdOrigins.has(serverOrigin) ? userId : undefined
        )
        const shouldRecover = shouldRecoverAppApiAuthentication(response)
        if (
          shouldRecover &&
          (await keyCacheService.recoverAccessTokenAfterUnauthorized(accessToken))
        ) {
          accessToken =
            keyCacheService.getAccessToken() ||
            safeStorageService.getAuthSession()?.accessToken ||
            null
          if (accessToken) {
            response = await fetchAppApi(
              request,
              accessToken,
              controller.signal,
              legacyBearerUserIdOrigins.has(serverOrigin) ? userId : undefined
            )
          }
        }
        if (shouldRecover && shouldRecoverAppApiAuthentication(response)) {
          keyCacheService.forceSignOutForInvalidSession()
        }
        if (response.status !== 401 && accessToken) {
          keyCacheService.markAccessTokenAccepted(accessToken)
        }

        const responseHeaders = headersToRecord(response.headers)
        event.sender.send('app-api:stream-event', {
          streamId,
          type: 'ready',
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders
        })

        if (!response.body) {
          event.sender.send('app-api:stream-event', { streamId, type: 'done' })
          return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            bodyText: '',
            headers: responseHeaders
          }
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            event.sender.send('app-api:stream-event', {
              streamId,
              type: 'chunk',
              chunk: decoder.decode(value, { stream: true })
            })
          }
          const finalChunk = decoder.decode()
          if (finalChunk) {
            event.sender.send('app-api:stream-event', {
              streamId,
              type: 'chunk',
              chunk: finalChunk
            })
          }
        } finally {
          reader.releaseLock()
        }

        event.sender.send('app-api:stream-event', { streamId, type: 'done' })
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          bodyText: '',
          headers: responseHeaders
        }
      } catch {
        const aborted = controller.signal.aborted
        const message = aborted ? 'Request aborted' : 'Network request failed'
        console.error(`[AppApiIPC] ${request.method} ${logPath} stream failed`)
        event.sender.send('app-api:stream-event', { streamId, type: 'error', error: message })
        return {
          ok: false,
          status: 0,
          statusText: 'Network Error',
          bodyText: JSON.stringify({ error: message })
        }
      } finally {
        activeStreams.delete(streamId)
      }
    }
  )

  ipcMain.handle('app-api:abort', (event, streamIdInput: unknown) => {
    validateSender(event, 'app-api:abort')
    const streamId = typeof streamIdInput === 'string' ? streamIdInput.trim() : ''
    if (!streamId) throw new Error('Invalid app API stream id')
    const active = activeStreams.get(streamId)
    if (!active || active.senderId !== event.sender.id) return { aborted: false }
    active.controller.abort()
    return { aborted: true }
  })
}

async function fetchAppApi(
  request: NormalizedAppApiRequest,
  accessToken: string,
  signal?: AbortSignal,
  claimedUserId?: string
): Promise<Response> {
  return fetchAppApiFromBase(
    serverProfileService.getActiveOrigin(),
    request,
    accessToken,
    signal,
    claimedUserId
  )
}

async function fetchAppApiFromBase(
  baseUrl: string,
  request: NormalizedAppApiRequest,
  accessToken: string,
  signal?: AbortSignal,
  claimedUserId?: string
): Promise<Response> {
  const url = new URL(request.path, baseUrl)
  if (claimedUserId) url.searchParams.set('userId', claimedUserId)
  const headers = sanitizeForwardedHeaders(request.headers)
  const body = request.body

  if (body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  headers.set('Authorization', `Bearer ${accessToken}`)

  return fetch(url.toString(), {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : body,
    signal
  })
}
