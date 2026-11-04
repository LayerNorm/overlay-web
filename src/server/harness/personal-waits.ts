import type { PersonalHarnessAccess } from './personal-access'
import { projectPersonalHarnessWait } from './personal-wait-steps'
import { createHarnessWaitPorts } from './waits'

export function createPersonalHarnessWaitPorts(input: {
  access: PersonalHarnessAccess
  wake: AsyncIterator<unknown>
  renewLease: () => Promise<void>
  checkFunding: (requiredCents: number) => Promise<boolean>
}) {
  return createHarnessWaitPorts({
    reference: input.access,
    wake: input.wake,
    renewLease: input.renewLease,
    checkFunding: input.checkFunding,
    projectWait: async projection => {
      return await projectPersonalHarnessWait(input.access, projection)
    },
  })
}
