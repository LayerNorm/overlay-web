import { strict as assert } from 'node:assert'
import test from 'node:test'
import { isNewAccountForDesktopSetup } from './desktop-setup'

const context = (kind = 'personal', role = 'owner') => ({
  auth: { userId: 'user-1' },
  workspace: { workspace: { id: 'personal-1', kind }, membership: { role } },
})
const only = (...ids: string[]) => async () => ids.map((id) => ({ workspace: { id, kind: id.startsWith('personal') ? 'personal' : 'organization' } }))

test('desktop setup is offered only to a new account with just its own personal workspace', async () => {
  const fresh = { completed: false, session: null }
  assert.equal(await isNewAccountForDesktopSetup(fresh, context(), only('personal-1')), true)
  assert.equal(await isNewAccountForDesktopSetup(fresh, context(), only('personal-1', 'team-1')), false)
  assert.equal(await isNewAccountForDesktopSetup({ completed: true, session: null }, context(), only('personal-1')), false)
  assert.equal(await isNewAccountForDesktopSetup({ completed: false, session: {} }, context(), only('personal-1')), false)
  assert.equal(await isNewAccountForDesktopSetup(fresh, context('organization'), only('personal-1')), false)
  assert.equal(await isNewAccountForDesktopSetup(fresh, context('personal', 'member'), only('personal-1')), false)
})
