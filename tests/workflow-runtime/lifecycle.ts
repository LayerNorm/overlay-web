import { createHook, sleep } from 'workflow'

export async function recordLifecycle(value: string) {
  'use step'
  return value
}

/** SDK contract fixture: use the installed 4.8.9 hook registration and durable replay implementation. */
export async function lifecycleHookFixture(input: { id: string }) {
  'use workflow'
  using hook = createHook<{ revision: number; decision: string }>({ token: `fixture:${input.id}` })
  const conflict = await hook.getConflict()
  if (conflict) return 'duplicate'
  await recordLifecycle('registered-before-dispatch')
  const decision = await hook
  await sleep('20m')
  return recordLifecycle(`${decision.revision}:${decision.decision}`)
}
