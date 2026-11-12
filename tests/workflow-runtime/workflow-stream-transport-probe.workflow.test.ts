import { expect, test } from 'vitest'
import { FatalError } from 'workflow'
import { start } from 'workflow/api'
import {
  workflowStreamTransportProbe,
  writeWorkflowStreamProbeChunks,
} from '../../src/server/workflows/workflow-stream-transport-probe'

const savedEnvironment = {
  VERCEL_ENV: process.env.VERCEL_ENV,
  OVERLAY_DEPLOYMENT_ENV: process.env.OVERLAY_DEPLOYMENT_ENV,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
}

function setPreviewEnvironment() {
  process.env.VERCEL_ENV = 'preview'
  process.env.OVERLAY_DEPLOYMENT_ENV = 'preview'
  process.env.NEXT_PUBLIC_APP_URL = 'https://pr-455.preview.getoverlay.io'
}

function restoreEnvironment() {
  for (const [key, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

test('compiled probe emits the fixed Unicode chunks in order and completes', async () => {
  setPreviewEnvironment()
  try {
    const run = await start(workflowStreamTransportProbe, [])
    const reader = run.getReadable().getReader()
    const chunks: Uint8Array[] = []
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    expect(chunks).toHaveLength(16)
    expect(chunks.map(chunk => new TextDecoder().decode(chunk))).toEqual(
      Array.from({ length: 16 }, (_, index) =>
        `workflow-stream-probe:${String(index + 1).padStart(2, '0')}: café 東京 🧪\n`),
    )
    await expect(run.returnValue).resolves.toEqual({ completed: true, chunkCount: 16 })
  } finally {
    restoreEnvironment()
  }
})

test('compiled probe rejects outside Preview before opening its writer', async () => {
  process.env.VERCEL_ENV = 'production'
  process.env.OVERLAY_DEPLOYMENT_ENV = 'production'
  process.env.NEXT_PUBLIC_APP_URL = 'https://www.getoverlay.io'
  try {
    const run = await start(workflowStreamTransportProbe, [])
    await expect(run.returnValue).rejects.toThrow('restricted to an isolated Preview deployment')
    await expect(run.getReadable().getReader().read()).resolves.toEqual({ done: true, value: undefined })
  } finally {
    restoreEnvironment()
  }
})

test('ambiguous probe writes fail fatally without replay and release the writer lock', async () => {
  let writes = 0
  let releases = 0
  const writer = {
    async write() {
      writes += 1
      throw new Error('ambiguous append result')
    },
    async close() {
      throw new Error('close must not follow an uncertain write')
    },
    releaseLock() {
      releases += 1
    },
  } as unknown as WritableStreamDefaultWriter<Uint8Array>

  let failure: unknown
  try {
    await writeWorkflowStreamProbeChunks(writer)
  } catch (error) {
    failure = error
  }
  expect(FatalError.is(failure)).toBe(true)
  expect(writes).toBe(1)
  expect(releases).toBe(1)
})
