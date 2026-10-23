import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { start, resumeHook } from 'workflow/api'
import { waitForHook } from '@workflow/vitest'
import { nativeAgentLoopFixture } from './native-agent-loop'

for (const decision of ['approve', 'deny', 'auto'] as const) {
  test(`native loop uses real serialized steps and ${decision} does not replay completed actions`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'native-loop-'))
    const auditPath = join(directory, 'events.txt')
    const id = crypto.randomUUID()
    try {
      const run = await start(nativeAgentLoopFixture, [{ id, auditPath, mode: decision === 'auto' ? 'auto' : 'ask' }])
      if (decision !== 'auto') {
        const hook = await waitForHook(run, { token: `native-loop:${id}` })
        expect((await readFile(auditPath, 'utf8')).trim().split('\n')).toEqual([
          'begin', 'model:0', 'inspect:read', 'execute:read', 'persist:1', 'inspect:write',
        ])
        await resumeHook(hook.token, { approved: decision === 'approve' })
      }
      expect(await run.returnValue).toEqual({
        content: 'Done',
        usage: {
          inputTokens: 2, outputTokens: 2, usageKnown: true,
          providerCallStarted: true, providerOutcomeAmbiguous: false,
        },
      })
      expect((await readFile(auditPath, 'utf8')).trim().split('\n')).toEqual([
        'begin', 'model:0', 'inspect:read', 'execute:read', 'persist:1', 'inspect:write',
        ...(decision === 'deny' ? [] : ['execute:write']),
        'persist:2', 'model:1', 'finalize',
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}
