import type { PersonalHarnessAccess } from './personal-access'
import { projectPersonalHarnessWait } from './personal-wait-steps'
import { createHarnessWaitPorts } from './waits'

export function createPersonalHarnessWaitPorts(input: {
  access: PersonalHarnessAccess
  wake: AsyncIterator<unknown>
}) {
  return createHarnessWaitPorts({
    reference: input.access,
    wake: input.wake,
    projectWait: async projection => {
      return await projectPersonalHarnessWait(input.access, projection)
    },
  })
}
