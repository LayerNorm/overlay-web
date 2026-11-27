import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

const mocks = vi.hoisted(() => ({ directory: '', request: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => mocks.directory } }))
vi.mock('axios', () => ({ default: mocks.request }))
let modelPath: string
beforeEach(() => {
  vi.resetModules()
  mocks.request.mockReset()
  mocks.directory = mkdtempSync(join(tmpdir(), 'overlay-model-repair-'))
  modelPath = join(mocks.directory, 'Overlay/models/whisperkit-coreml/openai_whisper-base')
  mkdirSync(modelPath, { recursive: true })
  writeFileSync(join(modelPath, 'existing-weights'), 'keep model bytes')
  mocks.request.mockImplementation(async () => ({ data: Readable.from(['{}']) }))
})
afterEach(() => rmSync(mocks.directory, { recursive: true, force: true }))

test('legacy weights are repaired with pinned tokenizer files before becoming offline-ready', async () => {
  const { modelDownloadService: service } = await import('./model-download-service')
  expect(await service.isModelInstalled('openai_whisper-base')).toBe(false)
  await service.downloadModel('openai_whisper-base')
  expect(await service.isModelInstalled('openai_whisper-base')).toBe(true)
  expect(readFileSync(join(modelPath, 'existing-weights'), 'utf8')).toBe('keep model bytes')
  expect(mocks.request.mock.calls.map(([request]) => request.url)).toEqual([
    'https://huggingface.co/openai/whisper-base/resolve/e37978b90ca9030d5170a5c07aadb050351a65bb/tokenizer.json',
    'https://huggingface.co/openai/whisper-base/resolve/e37978b90ca9030d5170a5c07aadb050351a65bb/tokenizer_config.json'
  ])
  await service.downloadModel('openai_whisper-base')
  expect(mocks.request).toHaveBeenCalledTimes(2)
})
test('failed tokenizer repair keeps existing weights and can resume', async () => {
  const { modelDownloadService: service } = await import('./model-download-service')
  mocks.request.mockRejectedValueOnce(new Error('offline'))
  await expect(service.downloadModel('openai_whisper-base')).rejects.toThrow('offline')
  expect(readFileSync(join(modelPath, 'existing-weights'), 'utf8')).toBe('keep model bytes')
  expect(await service.isModelInstalled('openai_whisper-base')).toBe(false)
  await service.downloadModel('openai_whisper-base')
  expect(await service.isModelInstalled('openai_whisper-base')).toBe(true)
})
