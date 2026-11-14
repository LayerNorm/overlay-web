import { expect, test, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { AutomationTurnError, assertAutomationByokModel } from './automation-turn-runner'

const byok = 'byok/connection_1/claude-opus-5-5'

test('a BYOK automation model is authorized by the user connection in the run workspace', async () => {
  const check = vi.fn(async () => ({}) as never)
  await assertAutomationByokModel(byok, 'user_1', 'workspace_1', check)
  expect(check).toHaveBeenCalledWith(byok, 'user_1', 'workspace_1')
})

test('a BYOK model the user can no longer use is a terminal 403 refusal', async () => {
  const check = vi.fn(async () => { throw new Error('BYOK connection not found.') })
  const refused = await assertAutomationByokModel(byok, 'user_1', 'workspace_1', check).catch(error => error)
  expect(refused).toBeInstanceOf(AutomationTurnError)
  expect(refused.statusCode).toBe(403)
  expect(refused.message).toContain('BYOK connection not found.')
})
