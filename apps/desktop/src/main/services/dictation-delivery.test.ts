import { describe, it, expect, vi } from 'vitest'
import { deliverDictation } from './dictation-delivery'

describe('dictation destination and clipboard protection', () => {
  const setup = () => {
    let clipboard = 'original'
    return {
      currentTarget: vi.fn(async () => 42 as number | null),
      snapshot: vi.fn(() => 'original' as string | null),
      write: vi.fn((text: string) => {
        clipboard = text
      }),
      read: () => clipboard,
      restore: vi.fn((text: string) => {
        clipboard = text
      }),
      paste: vi.fn(async () => {}),
      active: vi.fn(() => true)
    }
  }
  it('inserts into the original app then restores the clipboard', async () => {
    const io = setup()
    expect(await deliverDictation('hello', 42, io)).toBe('inserted')
    expect(io.paste).toHaveBeenCalledOnce()
    expect(io.read()).toBe('original')
  })
  it.each([null, 7])(
    'keeps the result for explicit copy if the destination is %s',
    async (target) => {
      const io = setup()
      expect(await deliverDictation('hello', target, io)).toBe('copy')
      expect(io.write).not.toHaveBeenCalled()
    }
  )
  it('does not touch application-specific clipboard data', async () => {
    const io = setup()
    io.snapshot.mockReturnValue(null)
    expect(await deliverDictation('hello', 42, io)).toBe('copy')
    expect(io.paste).not.toHaveBeenCalled()
  })
  it('restores on injection failure', async () => {
    const io = setup()
    io.paste.mockRejectedValue(new Error('denied'))
    expect(await deliverDictation('hello', 42, io)).toBe('copy')
    expect(io.read()).toBe('original')
  })
  it('preserves a new user copy while insertion is in flight', async () => {
    const io = setup()
    io.paste.mockImplementation(async () => {
      io.write('user copy')
    })
    await deliverDictation('hello', 42, io)
    expect(io.read()).toBe('user copy')
    expect(io.restore).not.toHaveBeenCalled()
  })
  it('fences cancellation during destination lookup', async () => {
    const io = setup()
    io.currentTarget.mockImplementation(async () => {
      io.active.mockReturnValue(false)
      return 42
    })
    expect(await deliverDictation('hello', 42, io)).toBe('copy')
    expect(io.paste).not.toHaveBeenCalled()
  })
})
