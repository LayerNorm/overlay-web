import { describe, it, expect, vi } from 'vitest'
import {
  headersToRecord,
  errorForStatus,
  desktopAppStreamText,
  DesktopApiError,
  overlayDesktopAppClient
} from './app-api-client'

describe('headersToRecord', () => {
  it('passes safe headers through', () => {
    const record = headersToRecord({
      'content-type': 'application/json',
      'x-request-id': 'abc'
    })

    expect(record).toEqual({
      'content-type': 'application/json',
      'x-request-id': 'abc'
    })
  })

  it('strips authorization, cookie, and proxy headers', () => {
    const record = headersToRecord(
      new Headers({
        Authorization: 'Bearer secret',
        cookie: 'session=xyz',
        'x-overlay-service-auth': 'internal',
        'proxy-connection': 'keep-alive',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json'
      })
    )

    expect(record).toEqual({
      'content-type': 'application/json'
    })
  })

  it('returns an empty record for undefined headers', () => {
    expect(headersToRecord(undefined)).toEqual({})
  })
})

describe('errorForStatus', () => {
  it('maps 401 to unauthenticated', () => {
    const error = errorForStatus(401, 'Not authenticated')
    expect(error).toBeInstanceOf(DesktopApiError)
    expect(error.code).toBe('unauthenticated')
    expect(error.status).toBe(401)
  })

  it('maps 404 to not_found', () => {
    const error = errorForStatus(404, 'Not found')
    expect(error.code).toBe('not_found')
    expect(error.status).toBe(404)
  })

  it('maps status 0 to network', () => {
    const error = errorForStatus(0, 'offline')
    expect(error.code).toBe('network')
    expect(error.status).toBeUndefined()
  })

  it('maps unknown statuses to server', () => {
    const error = errorForStatus(500, 'Server error')
    expect(error.code).toBe('server')
    expect(error.status).toBe(500)
  })
})

describe('streaming desktop API response', () => {
  it('preserves response metadata and aborts the main-process stream', async () => {
    const abort = vi.fn().mockResolvedValue({ aborted: true })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        bridge: {
          appApi: {
            request: vi.fn(),
            abort,
            stream: vi.fn(async (input, callback) => {
              callback({
                type: 'ready',
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'text/event-stream', 'x-request-id': 'request-1' }
              })
              return { ok: true, status: 200, statusText: 'OK', bodyText: '' }
            })
          }
        }
      }
    })
    const controller = new AbortController()
    const response = await overlayDesktopAppClient.chat.generateVideoResponse(
      { prompt: 'A calm ocean', modelId: 'video-1' },
      { signal: controller.signal }
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBe('request-1')

    const pendingRead = response.body!.getReader().read()
    controller.abort()
    await expect(pendingRead).rejects.toMatchObject({ name: 'AbortError' })
    expect(abort).toHaveBeenCalledTimes(1)
    expect(abort.mock.calls[0]?.[0]).toEqual(expect.any(String))
  })

  it('cancels the IPC reader when the consumer receives a terminal protocol event', async () => {
    const abort = vi.fn().mockResolvedValue({ aborted: true })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        bridge: {
          appApi: {
            request: vi.fn(),
            abort,
            stream: vi.fn(async (_input, callback) => {
              callback({
                type: 'ready',
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'text/event-stream' }
              })
              callback({ type: 'chunk', chunk: 'data: [DONE]\n\n' })
              return { ok: true, status: 200, statusText: 'OK', bodyText: '' }
            })
          }
        }
      }
    })
    const received: string[] = []

    await desktopAppStreamText(
      '/api/v1/conversations/act',
      { method: 'POST', body: '{}' },
      (chunk) => {
        received.push(chunk)
        return false
      }
    )

    expect(received).toEqual(['data: [DONE]\n\n'])
    expect(abort).toHaveBeenCalledTimes(1)
  })
})
