import { expect, test, vi } from 'vitest'
import { HarnessPlanValidationError } from '@overlay/agent-runtime/harness-state'
import { createHarnessControlTools } from './control-tools'
import type { HarnessExecutionPorts } from './ports'

const snapshot = { planRevision: 3, plan: [] }

test('targeted revision schema is strict and executes only the requested patch', async () => {
  const apply = vi.fn(async () => snapshot)
  const ports = { apply, read: async () => snapshot } as unknown as HarnessExecutionPorts
  const revise = createHarnessControlTools(ports).harness_revise_step
  expect(revise.description).toBe(
    'Revise one existing milestone definition without rewriting other milestones. Omit unchanged fields. Changed requirements invalidate affected completion; status and evidence belong in harness_update_step.',
  )
  expect(() => revise.inputSchema.parse({ id: 'work', patch: {} })).toThrow()
  expect(() => revise.inputSchema.parse({ id: 'work', patch: { status: 'done' } })).toThrow()
  expect(() => revise.inputSchema.parse({ id: 'work', patch: { evidenceRefs: ['tool:read'] } })).toThrow()
  expect(() => revise.inputSchema.parse({ id: 'work', patch: { title: 'One', extra: true } })).toThrow()
  await expect(revise.execute!({ id: 'work', patch: { title: 'One' } }, {
    toolCallId: 'revise-1', messages: [],
  })).resolves.toEqual(snapshot)
  expect(apply).toHaveBeenCalledWith('control:revise-1', {
    type: 'revise_step', id: 'work', patch: { title: 'One' },
  })
})

test('targeted revision returns the specified private validation hint', async () => {
  const apply = vi.fn(async () => { throw new HarnessPlanValidationError('Unauthorized evidence tool.') })
  const ports = { apply, read: async () => snapshot } as unknown as HarnessExecutionPorts
  const revise = createHarnessControlTools(ports).harness_revise_step
  await expect(revise.execute!({ id: 'work', patch: { evidenceTools: ['missing'] } }, {
    toolCallId: 'invalid-revision', messages: [],
  })).resolves.toMatchObject({
    success: false,
    error: 'Unauthorized evidence tool.',
    hint: 'Correct only this milestone definition and retry with harness_revise_step. Do not include status or evidenceRefs. Keep authorized evidenceTools; use harness_update_step to skip unnecessary conditional work with a factual reason.',
  })
})
