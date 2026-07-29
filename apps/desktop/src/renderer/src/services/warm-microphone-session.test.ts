import { describe, expect, it, vi } from 'vitest'
import { WarmMicrophoneSession } from './warm-microphone-session'

function createFakeStream(): {
  stream: MediaStream
  track: MediaStreamTrack
  end: () => void
} {
  let onEnded: (() => void) | undefined
  const mutableTrack = {
    enabled: true,
    readyState: 'live',
    stop: vi.fn(),
    addEventListener: vi.fn((event: string, listener: () => void) => {
      if (event === 'ended') onEnded = listener
    })
  }
  const track = mutableTrack as unknown as MediaStreamTrack
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track]
  } as unknown as MediaStream
  return {
    stream,
    track,
    end: () => {
      mutableTrack.readyState = 'ended'
      onEnded?.()
    }
  }
}

describe('WarmMicrophoneSession', () => {
  it('keeps the audio pipeline live, then activates without reacquiring', async () => {
    const { stream, track } = createFakeStream()
    const getUserMedia = vi.fn(async () => stream)
    const session = new WarmMicrophoneSession(getUserMedia)

    await session.warm('default')
    expect(track.enabled).toBe(true)

    await expect(session.activate('default')).resolves.toBe(stream)
    expect(track.enabled).toBe(true)
    expect(getUserMedia).toHaveBeenCalledTimes(1)

    session.deactivate()
    expect(track.enabled).toBe(false)
    expect(track.stop).not.toHaveBeenCalled()

    await session.warm('default')
    expect(track.enabled).toBe(true)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('shares an in-flight warmup with an immediate activation', async () => {
    const { stream, track } = createFakeStream()
    let resolveStream: ((stream: MediaStream) => void) | undefined
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveStream = resolve
        })
    )
    const session = new WarmMicrophoneSession(getUserMedia)

    const warmPromise = session.warm('default')
    const activatePromise = session.activate('default')
    resolveStream?.(stream)

    await Promise.all([warmPromise, activatePromise])
    expect(track.enabled).toBe(true)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('releases the previous stream when the selected device changes', async () => {
    const first = createFakeStream()
    const second = createFakeStream()
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(second.stream)
    const session = new WarmMicrophoneSession(getUserMedia)

    await session.warm('first-device')
    await session.warm('second-device')

    expect(first.track.stop).toHaveBeenCalledTimes(1)
    expect(second.track.enabled).toBe(true)
    expect(getUserMedia).toHaveBeenNthCalledWith(1, {
      audio: { deviceId: { exact: 'first-device' } }
    })
    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      audio: { deviceId: { exact: 'second-device' } }
    })
  })

  it('falls back to the default input and stops it on disposal', async () => {
    const fallback = createFakeStream()
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new Error('device_missing'))
      .mockResolvedValueOnce(fallback.stream)
    const session = new WarmMicrophoneSession(getUserMedia)

    await session.warm('missing-device')
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: true })

    session.dispose()
    expect(fallback.track.stop).toHaveBeenCalledTimes(1)
  })

  it('can record again after an opt-out releases the warm stream', async () => {
    const warm = createFakeStream()
    const cold = createFakeStream()
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(warm.stream)
      .mockResolvedValueOnce(cold.stream)
    const session = new WarmMicrophoneSession(getUserMedia)

    await session.warm('default')
    session.dispose()

    expect(warm.track.stop).toHaveBeenCalledTimes(1)
    await expect(session.activate('default')).resolves.toBe(cold.stream)
    expect(cold.track.enabled).toBe(true)
    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })

  it('restores an idle warm stream if the operating system ends it', async () => {
    const first = createFakeStream()
    const replacement = createFakeStream()
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(first.stream)
      .mockResolvedValueOnce(replacement.stream)
    const session = new WarmMicrophoneSession(getUserMedia)

    await session.warm('default')
    first.end()

    await vi.waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledTimes(2)
      expect(replacement.track.enabled).toBe(true)
    })
  })
})
