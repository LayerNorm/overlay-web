import { afterEach, describe, expect, it, vi } from 'vitest'
import { embedViaGateway } from './knowledge'

describe('embedViaGateway', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('applies a 30-second timeout to a stalled embedding request', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test-key')

    const controller = new AbortController()
    const timeoutError = Object.assign(new Error('embedding request timed out'), {
      name: 'TimeoutError',
    })
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(controller.signal)

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal)
      controller.abort(timeoutError)
      throw controller.signal.reason
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(embedViaGateway(['text to embed'])).rejects.toMatchObject({
      name: 'TimeoutError',
    })

    expect(timeoutSpy).toHaveBeenCalledOnce()
    expect(timeoutSpy).toHaveBeenCalledWith(30_000)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})