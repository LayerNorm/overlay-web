import { expect, test, vi } from 'vitest'
import type { LanguageModelV4Prompt } from '@ai-sdk/provider'
import {
  estimateHarnessPromptTokens,
  externalizeOlderHarnessToolResults,
  harnessArtifactReference,
  harnessToolResultText,
  parseHarnessArtifactOutput,
  readHarnessArtifactMedia,
  readHarnessArtifactText,
  serializeHarnessArtifactOutput,
  shouldExternalizeHarnessToolOutput,
} from './artifact-context'

vi.mock('server-only', () => ({}))

const metadata = {
  artifactId: `ha_${'a'.repeat(64)}`,
  runId: 'run-1',
  workflowRunId: 'workflow-1',
  toolCallId: 'render-1',
  toolName: 'render_document',
  digest: 'b'.repeat(64),
  storageId: 'storage-1',
  byteSize: 1,
  mediaPartCount: 1,
  createdAt: 1,
  expiresAt: 2,
  resource: { id: 'file-1', revision: 'rev-2', page: 3 },
}

test('artifact serialization preserves exact typed media bytes and media type', () => {
  const bytes = new Uint8Array([0, 1, 2, 127, 255])
  const serialized = serializeHarnessArtifactOutput({
    type: 'image', mediaType: 'image/png', data: bytes,
    display: 'Rendered page 3 of file-1.',
  })
  const parsed = parseHarnessArtifactOutput(serialized)
  expect(parsed.binaryParts).toHaveLength(1)
  expect(readHarnessArtifactMedia(serialized, 0)).toEqual({ data: bytes, mediaType: 'image/png' })
})

test('mapped SDK file content captures declared bare base64 bytes without exposing them in excerpts', () => {
  const bytes = new Uint8Array([0, 1, 2, 127, 255])
  const encoded = Buffer.from(bytes).toString('base64')
  const output = {
    type: 'content',
    value: [{
      type: 'file',
      mediaType: 'image/png',
      data: { type: 'data', data: encoded },
    }],
  }
  const serialized = serializeHarnessArtifactOutput(output)
  expect(parseHarnessArtifactOutput(serialized).binaryParts).toMatchObject([{ mediaType: 'image/png' }])
  expect(readHarnessArtifactMedia(serialized, 0)).toEqual({ data: bytes, mediaType: 'image/png' })
  expect(harnessToolResultText(output)).not.toContain(encoded)
})

test('artifact text reads are bounded and explicitly identify remaining text', () => {
  const serialized = serializeHarnessArtifactOutput({ text: 'A'.repeat(100) })
  expect(readHarnessArtifactText(serialized, 10, 30)).toBe(`[Incomplete: characters before 10 were omitted.]\n${'A'.repeat(20)}\n[Incomplete: more artifact text is available after character 30.]`)
  expect(readHarnessArtifactText(serialized, 90, 100)).toBe(`[Incomplete: characters before 90 were omitted.]\n${'A'.repeat(10)}`)
  expect(() => readHarnessArtifactText(serialized, 0, 16_001)).toThrow(/range exceeds/)
})

test('artifact references preserve resource identity and disclose incompleteness', () => {
  const reference = harnessArtifactReference(metadata, 'First lines')
  expect(reference).toContain(metadata.artifactId)
  expect(reference).toContain('render_document call render-1')
  expect(reference).toContain('file-1 revision rev-2 page 3')
  expect(reference).toContain('Incomplete')
  expect(reference).toContain('First lines')
})

test('externalization preserves tool result pairing and keeps the latest fitting observation inline', () => {
  const prompt: LanguageModelV4Prompt = [
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'old', toolName: 'read', input: {} }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'old', toolName: 'read', output: { text: 'old'.repeat(6_000) } }] },
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'latest', toolName: 'render', input: {} }] },
    { role: 'tool', content: [{
      type: 'tool-result', toolCallId: 'latest', toolName: 'render',
      output: { type: 'image', mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) },
    }] },
  ]
  const transformed = externalizeOlderHarnessToolResults(prompt, new Map([
    ['old', { ...metadata, toolCallId: 'old', toolName: 'read' }],
    ['latest', { ...metadata, toolCallId: 'latest', toolName: 'render' }],
  ]))
  expect(transformed[0]).toEqual(prompt[0])
  expect(transformed[1]?.role).toBe('tool')
  if (transformed[1]?.role === 'tool') {
    expect(transformed[1].content[0]?.type).toBe('tool-result')
    expect(JSON.stringify(transformed[1].content[0])).toContain(metadata.artifactId)
  }
  expect(transformed[2]).toEqual(prompt[2])
  expect(transformed[3]).toEqual(prompt[3])
})

test('modality-aware estimates do not expand image bytes as base64 text and still charge arbitrary files', () => {
  const base64 = 'A'.repeat(80_000)
  const imageTokens = estimateHarnessPromptTokens({ type: 'image', image: base64, mediaType: 'image/png' })
  const fileTokens = estimateHarnessPromptTokens({ type: 'file', data: base64, mediaType: 'application/pdf' })
  expect(imageTokens).toBeLessThan(9_000)
  expect(fileTokens).toBeGreaterThan(imageTokens)
  expect(estimateHarnessPromptTokens(new Uint8Array(40_000))).toBeGreaterThan(1)
  expect(shouldExternalizeHarnessToolOutput({ type: 'image', mediaType: 'image/png', data: base64 })).toBe(true)
})
