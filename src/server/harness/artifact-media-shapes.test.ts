import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import {
  parseHarnessArtifactOutput,
  readHarnessArtifactMedia,
  serializeHarnessArtifactOutput,
} from './artifact-context'

describe('mapped provider media artifacts', () => {
  it('round-trips the nested file/data shape used by the work-tool mapper', () => {
    const mapped = {
      type: 'content',
      value: [{
        type: 'file',
        mediaType: 'image/png',
        data: { type: 'data', data: 'AP8QgA==' },
      }],
    }
    const serialized = serializeHarnessArtifactOutput(mapped)
    const parsed = parseHarnessArtifactOutput(serialized)
    expect(parsed.binaryParts).toHaveLength(1)
    expect(parsed.binaryParts[0]?.mediaType).toBe('image/png')
    expect(readHarnessArtifactMedia(serialized, 0)).toEqual({
      mediaType: 'image/png',
      data: new Uint8Array([0, 255, 16, 128]),
    })
  })
})
