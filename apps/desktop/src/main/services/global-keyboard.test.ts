import { describe, expect, it, vi } from 'vitest'
import { sendGlobalKey } from './global-keyboard'

describe('sendGlobalKey', () => {
  it('uses native injection without starting System Events', async () => {
    const sendNative = vi.fn(async () => undefined)
    const sendWithSystemEvents = vi.fn(async () => undefined)

    await expect(sendGlobalKey('paste', { sendNative, sendWithSystemEvents })).resolves.toBe(
      'native'
    )
    expect(sendNative).toHaveBeenCalledWith('paste')
    expect(sendWithSystemEvents).not.toHaveBeenCalled()
  })

  it('falls back when native injection is unavailable', async () => {
    const sendNative = vi.fn(async () => {
      throw new Error('native_unavailable')
    })
    const sendWithSystemEvents = vi.fn(async () => undefined)

    await expect(sendGlobalKey('enter', { sendNative, sendWithSystemEvents })).resolves.toBe(
      'system-events'
    )
    expect(sendWithSystemEvents).toHaveBeenCalledWith('enter')
  })

  it('surfaces a delivery failure when both backends fail', async () => {
    const sendNative = vi.fn(async () => {
      throw new Error('native_unavailable')
    })
    const sendWithSystemEvents = vi.fn(async () => {
      throw new Error('system_events_unavailable')
    })

    await expect(sendGlobalKey('paste', { sendNative, sendWithSystemEvents })).rejects.toThrow(
      'system_events_unavailable'
    )
  })
})
