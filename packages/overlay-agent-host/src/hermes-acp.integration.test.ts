import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AcpAgentAdapter } from './acp-adapter'
import type { NormalizedAgentEvent } from './adapter'

const hermesCommand = process.env.OVERLAY_HERMES_ACP_COMMAND?.trim()

test('Hermes ACP streams and resumes a complete turn through the production adapter', {
  skip: hermesCommand ? false : 'Set OVERLAY_HERMES_ACP_COMMAND to run the live Hermes conformance test.',
  timeout: 120_000,
}, async () => {
  const workingDirectory = await mkdtemp(join(tmpdir(), 'overlay-hermes-acp-'))
  const events: NormalizedAgentEvent[] = []
  const createAdapter = () => new AcpAgentAdapter({
    id: 'hermes',
    displayName: 'Hermes',
    command: hermesCommand!,
    args: ['acp'],
  })
  const adapter = createAdapter()
  let session: Awaited<ReturnType<typeof adapter.start>> | undefined
  try {
    session = await adapter.start({
      runId: 'hermes-live-conformance',
      workingDirectory,
      additionalDirectories: [],
      prompt: '',
      metadata: {},
    }, async (event) => { events.push(event) })
    await session.prompt('Reply with exactly OVERLAY_HERMES_OK and do not use tools.')
    const checkpoint = events.filter((event) => event.type === 'text_checkpoint').at(-1)
    assert.equal(checkpoint?.payload.text, 'OVERLAY_HERMES_OK')
    assert.ok(events.some((event) => event.type === 'completed'))

    const remoteSessionId = session.remoteSessionId
    await session.stop()
    session = await createAdapter().start({
      runId: 'hermes-live-conformance-resume',
      workingDirectory,
      additionalDirectories: [],
      remoteSessionId,
      prompt: '',
      metadata: {},
    }, async (event) => { events.push(event) })
    assert.equal(session.remoteSessionId, remoteSessionId)
    await session.prompt('Reply with exactly OVERLAY_HERMES_RESUMED and do not use tools.')
    const resumedCheckpoint = events.filter((event) => event.type === 'text_checkpoint').at(-1)
    assert.equal(resumedCheckpoint?.payload.text, 'OVERLAY_HERMES_OKOVERLAY_HERMES_RESUMED')
  } finally {
    await session?.stop()
    await rm(workingDirectory, { recursive: true, force: true })
  }
})
