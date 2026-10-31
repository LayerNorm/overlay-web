import type { PersonalHarnessAccess } from './personal-access'
import type { PersonalChatWorkToolingContext } from '@/shared/agents/personal-chat-work'
import { deliverSurfaceWaitNoticeStep } from './surface-wait-steps'
import { projectPersonalHarnessWait } from './personal-wait-steps'
import { createHarnessWaitPorts } from './waits'

export function createPersonalHarnessWaitPorts(input: {
  access: PersonalHarnessAccess
  wake: AsyncIterator<unknown>
  context?: Pick<PersonalChatWorkToolingContext, 'turnId' | 'accountAllowedToolIds' | 'accountAllowedConnectorIds' | 'integrationToolIds'>
  surface?: { placeholderTs?: string }
}) {
  return createHarnessWaitPorts({
    reference: input.access,
    wake: input.wake,
    projectWait: async projection => {
      const result = await projectPersonalHarnessWait(input.access, projection)
      if (result === 'projected' && input.surface?.placeholderTs && input.context) {
        await deliverSurfaceWaitNoticeStep({
          access: input.access,
          context: input.context,
          placeholderTs: input.surface.placeholderTs,
          projection,
        }).catch((_error) => undefined)
      }
      return result
    },
  })
}
