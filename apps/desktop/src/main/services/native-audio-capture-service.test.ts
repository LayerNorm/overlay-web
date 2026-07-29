import { describe, expect, it } from 'vitest'
import {
  findNativeAudioHelperPath,
  isRecordingPathAllowed,
  parseNativeAudioHelperMessage
} from './native-audio-capture-service'

describe('native audio capture helper boundary', () => {
  it('accepts only line-delimited object messages with a type', () => {
    expect(parseNativeAudioHelperMessage('{"type":"ready","protocolVersion":1}')).toEqual({
      type: 'ready',
      protocolVersion: 1
    })
    expect(parseNativeAudioHelperMessage('[]')).toBeNull()
    expect(parseNativeAudioHelperMessage('{"ok":true}')).toBeNull()
    expect(parseNativeAudioHelperMessage('not-json')).toBeNull()
  })

  it('allows recordings only beneath the dedicated output directory', () => {
    expect(
      isRecordingPathAllowed(
        '/private/tmp/overlay-native-audio',
        '/private/tmp/overlay-native-audio/recording.wav'
      )
    ).toBe(true)
    expect(
      isRecordingPathAllowed(
        '/private/tmp/overlay-native-audio',
        '/private/tmp/overlay-native-audio/../secret'
      )
    ).toBe(false)
    expect(isRecordingPathAllowed('/private/tmp/overlay-native-audio', 'recording.wav')).toBe(false)
  })

  it('resolves only an existing packaged or development helper', () => {
    expect(
      findNativeAudioHelperPath({
        resourcesPath: '/does/not/exist',
        appPath: '/also/missing',
        moduleDirectory: '/still/missing'
      })
    ).toBeNull()
  })
})
