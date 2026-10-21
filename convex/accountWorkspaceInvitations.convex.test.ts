import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'account-directory-test'
const now = 1_900_000_000_000
const listReceivedInvitations = makeFunctionReference<'query'>(
  'collaboration/workspaces:listReceivedInvitationsByServer',
)

test('received invitation query filters recipients, status, expiry, and archived workspaces', async () => {
  process.env.INTERNAL_API_SECRET = secret
  const convex = convexTest(schema, modules)
  await convex.run(async (ctx) => {
    await ctx.db.insert('workspaces', {
      workspaceId: 'active',
      kind: 'organization',
      name: 'Acme',
      slug: 'acme',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.insert('workspaces', {
      workspaceId: 'archived',
      kind: 'organization',
      name: 'Old Acme',
      slug: 'old-acme',
      status: 'archived',
      createdAt: now,
      updatedAt: now,
    })
    const invite = async (invitationId: string, workspaceId: string, email: string, status: 'pending' | 'cancelled', expiresAt: number) =>
      await ctx.db.insert('workspaceInvitations', {
        invitationId,
        workspaceId,
        email,
        role: 'member',
        status,
        invitedByPrincipalId: 'owner',
        expiresAt,
        createdAt: now - 100,
        updatedAt: now - 100,
      })
    for (let index = 0; index < 500; index += 1) {
      await invite(`expired-${index}`, 'active', 'member@example.test', 'pending', now)
    }
    await invite('valid', 'active', 'member@example.test', 'pending', now + 100)
    await invite('cancelled', 'active', 'member@example.test', 'cancelled', now + 100)
    await invite('other', 'active', 'other@example.test', 'pending', now + 100)
    await invite('archived', 'archived', 'member@example.test', 'pending', now + 100)
  })

  const result = await convex.query(listReceivedInvitations, {
    serverSecret: secret,
    email: ' MEMBER@example.test ',
    now,
  })
  expect(result).toEqual([{
    id: 'valid',
    workspaceId: 'active',
    workspaceName: 'Acme',
    role: 'member',
    expiresAt: now + 100,
  }])
})
