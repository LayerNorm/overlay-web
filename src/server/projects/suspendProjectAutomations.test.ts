import assert from 'node:assert/strict'
import test from 'node:test'
import type { AutomationRepository } from '@/server/automations/AutomationRepository'
import { suspendProjectAutomations } from './suspendProjectAutomations'

test('suspending project automations pauses schedules and cancels active runs', async () => {
  const paused: string[] = []
  const cancelled: string[] = []
  const repository = {
    async listAutomations() {
      return [
        { _id: 'automation-a', createdAt: 1, enabled: true, updatedAt: 1, userId: 'user-a' },
        { _id: 'automation-b', createdAt: 1, enabled: false, updatedAt: 1, userId: 'user-a' },
      ]
    },
    async listRuns() { return [] },
    async pauseAutomation({ automationId }: { automationId: string }) {
      paused.push(automationId)
    },
    async requestRunCancellation() { return false },
    async requestActiveRunCancellation({ automationId }: { automationId: string }) {
      cancelled.push(automationId)
      return automationId === 'automation-a' ? 2 : 1
    },
  } as unknown as Pick<
    AutomationRepository,
    'listAutomations' | 'listRuns' | 'pauseAutomation'
    | 'requestActiveRunCancellation' | 'requestRunCancellation'
  >

  assert.deepEqual(await suspendProjectAutomations({
    projectId: 'project-a',
    repository,
    userId: 'user-a',
  }), {
    cancelledRuns: 3,
    pausedAutomations: 1,
  })
  assert.deepEqual(paused, ['automation-a'])
  assert.deepEqual(cancelled.sort(), ['automation-a', 'automation-b'])
})
