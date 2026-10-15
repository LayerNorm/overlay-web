import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import type { AuthorizationRepositories } from '@overlay/authz-contracts'

/** The customer-web adapter can read authorization, but cannot administer it. */
export async function runAuthorizationRepositoryContract(t: TestContext, args: {
  repositories: AuthorizationRepositories
  createUser(userId: string): Promise<void>
  cleanupUser(userId: string): Promise<void>
  scope: string
}): Promise<void> {
  const userId = `${args.scope}_user`
  await args.createUser(userId)
  try {
    await t.test('customer authorization reads remain available', async () => {
      assert.ok(Array.isArray(await args.repositories.groups.listForUser(userId)))
      assert.ok(Array.isArray(await args.repositories.assignments.listForUser(userId)))
      assert.equal(await args.repositories.roles.get(`${args.scope}_missing`), null)
    })
    await t.test('customer adapter rejects operator writes before making requests', async () => {
      await assert.rejects(args.repositories.roles.create({ id: args.scope, name: args.scope, capabilities: ['roles.manage'] }), /standalone admin/)
      await assert.rejects(args.repositories.groups.create({ id: args.scope, name: args.scope }), /standalone admin/)
      await assert.rejects(args.repositories.assignments.assignUser({ userId, roleId: 'system:administrator' }), /standalone admin/)
      await assert.rejects(args.repositories.resourceGrants.remove(args.scope), /standalone admin/)
    })
  } finally { await args.cleanupUser(userId) }
}
