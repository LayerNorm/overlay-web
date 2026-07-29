import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { ConvexWorkspaceRepository } from './ConvexWorkspaceRepository'
import { ConvexActConversationRepository } from '@/server/conversations/ConvexActConversationRepository'
import type { ActConversationRepository } from '@/server/conversations/ActConversationRepository'

const enabled = process.env.WORKSPACE_CONTRACT_CONVEX === '1'
const hasConvexUrl = Boolean(
  process.env.DEV_NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL,
)
const hasInternalSecret = Boolean(process.env.INTERNAL_API_SECRET?.trim())

test('Convex workspace repository matches the Phase 1 lifecycle contract', {
  skip: enabled && hasConvexUrl && hasInternalSecret
    ? false
    : 'Set WORKSPACE_CONTRACT_CONVEX=1 plus Convex URL and INTERNAL_API_SECRET',
}, async (t) => {
  const repository = new ConvexWorkspaceRepository()
  const scope = `workspace_${randomUUID().replaceAll('-', '')}`
  const ownerUserId = `${scope}_owner`
  const invitedUserId = `${scope}_invited`
  const personalWorkspaceId = `${scope}_personal`
  const orgWorkspaceId = `${scope}_org`
  const ownerPrincipalId = `${scope}_owner_principal`
  const invitedPrincipalId = `${scope}_invited_principal`
  let orgArchived = false

  try {
    await t.test('Personal workspace creation is idempotent and isolated', async () => {
      const first = await repository.ensurePersonalWorkspace({
        workspaceId: personalWorkspaceId,
        slug: personalWorkspaceId,
        principalId: `${scope}_personal_principal`,
        userId: ownerUserId,
        displayName: 'Owner',
        email: `${ownerUserId}@example.com`,
        now: 100,
      })
      const repeated = await repository.ensurePersonalWorkspace({
        workspaceId: `${personalWorkspaceId}_duplicate`,
        slug: `${personalWorkspaceId}-duplicate`,
        principalId: `${scope}_duplicate_principal`,
        userId: ownerUserId,
        displayName: 'Owner',
        now: 101,
      })
      assert.equal(first.workspace.id, personalWorkspaceId)
      assert.equal(repeated.workspace.id, personalWorkspaceId)
      assert.equal(await repository.getAccess({
        workspaceId: personalWorkspaceId,
        userId: invitedUserId,
      }), null)
    })

    await t.test('organization invitation and ownership lifecycle matches Postgres', async () => {
      const created = await repository.createOrganization({
        workspaceId: orgWorkspaceId,
        ownerPrincipalId,
        actorUserId: ownerUserId,
        ownerDisplayName: 'Owner',
        ownerEmail: `${ownerUserId}@example.com`,
        name: 'Acme',
        slug: orgWorkspaceId,
        now: 200,
      })
      assert.equal(created.membership.role, 'owner')
      const invitation = await repository.createInvitationReplacingPending({
        id: `${scope}_invite`,
        workspaceId: orgWorkspaceId,
        email: `${invitedUserId}@example.com`,
        role: 'admin',
        invitedByPrincipalId: ownerPrincipalId,
        expiresAt: Date.now() + 60_000,
        now: Date.now(),
      })
      assert.equal((await repository.acceptInvitation({
        invitationId: invitation.id,
        principalId: `${invitedPrincipalId}_wrong`,
        userId: invitedUserId,
        email: `wrong-${scope}@example.com`,
        displayName: 'Invited',
        now: Date.now(),
      })).status, 'email_mismatch')
      const accepted = await repository.acceptInvitation({
        invitationId: invitation.id,
        principalId: invitedPrincipalId,
        userId: invitedUserId,
        email: invitation.email,
        displayName: 'Invited',
        now: Date.now(),
      })
      assert.equal(accepted.status, 'accepted')
      assert.equal((await repository.setMembershipRole({
        workspaceId: orgWorkspaceId,
        principalId: ownerPrincipalId,
        role: 'member',
        now: Date.now(),
      })).status, 'last_owner')
      assert.equal((await repository.transferOwnership({
        workspaceId: orgWorkspaceId,
        fromPrincipalId: ownerPrincipalId,
        toPrincipalId: invitedPrincipalId,
        now: Date.now(),
      })).status, 'transferred')
    })

    await t.test('agent team membership is durable', async () => {
      const agent = await repository.createPrincipal({
        id: `${scope}_agent_principal`,
        workspaceId: orgWorkspaceId,
        type: 'agent',
        agentId: `${scope}_agent`,
        displayName: 'Research agent',
        createdByPrincipalId: invitedPrincipalId,
        now: Date.now(),
      })
      const team = await repository.createTeam({
        id: `${scope}_team`,
        workspaceId: orgWorkspaceId,
        name: 'Research',
        createdByPrincipalId: invitedPrincipalId,
        now: Date.now(),
      })
      await repository.addTeamMember({
        teamId: team.id,
        workspaceId: orgWorkspaceId,
        principalId: agent.id,
        principalType: 'agent',
        addedByPrincipalId: invitedPrincipalId,
        now: Date.now(),
      })
      assert.equal((await repository.listTeamMembers(team.id))[0]?.principalType, 'agent')
    })

    await t.test('resource ownership is isolated across workspaces', async () => {
      const resourceId = `${scope}_project`
      assert.equal((await repository.bindResource({
        workspaceId: orgWorkspaceId,
        resourceType: 'project',
        resourceId,
        now: Date.now(),
      })).workspaceId, orgWorkspaceId)
      assert.equal((await repository.getResourceWorkspace({
        resourceType: 'project',
        resourceId,
      }))?.workspaceId, orgWorkspaceId)
      await assert.rejects(
        () => repository.bindResource({
          workspaceId: personalWorkspaceId,
          resourceType: 'project',
          resourceId,
          now: Date.now(),
        }),
        /WORKSPACE_RESOURCE_SCOPE_CONFLICT/,
      )
    })

    await t.test('conversations and authorship are isolated by workspace', async () => {
      const conversations: ActConversationRepository = new ConvexActConversationRepository()
      const personalId = await conversations.createConversation({
        workspaceId: personalWorkspaceId,
        createdByPrincipalId: `${scope}_personal_principal`,
        conversationType: 'personal',
        userId: ownerUserId,
        title: 'Personal chat',
        askModelIds: ['openrouter/free'],
        actModelId: 'openrouter/free',
      })
      const organizationId = await conversations.createConversation({
        workspaceId: orgWorkspaceId,
        createdByPrincipalId: ownerPrincipalId,
        conversationType: 'personal',
        userId: ownerUserId,
        title: 'Organization chat',
        askModelIds: ['openrouter/free'],
        actModelId: 'openrouter/free',
      })
      assert.deepEqual(
        (await conversations.listConversations({
          workspaceId: personalWorkspaceId,
          conversationType: 'personal',
          userId: ownerUserId,
        })).map((conversation) => conversation._id),
        [personalId],
      )
      assert.deepEqual(
        (await conversations.listConversations({
          workspaceId: orgWorkspaceId,
          conversationType: 'personal',
          userId: ownerUserId,
        })).map((conversation) => conversation._id),
        [organizationId],
      )
      await conversations.addMessage({
        workspaceId: personalWorkspaceId,
        conversationId: personalId,
        userId: ownerUserId,
        turnId: `${scope}_turn`,
        role: 'user',
        mode: 'act',
        content: 'Scoped message',
        contentType: 'text',
      })
      const [message] = await conversations.getConversationMessages({
        workspaceId: personalWorkspaceId,
        conversationId: personalId,
        userId: ownerUserId,
      })
      assert.equal(message?.authorKind, 'human')
      assert.equal(message?.authorPrincipalId, `${scope}_personal_principal`)
      assert.equal((await repository.getResourceWorkspace({
        resourceType: 'conversation',
        resourceId: personalId,
      }))?.workspaceId, personalWorkspaceId)
    })

    await t.test('account deletion erases Personal data and scrubs organization identity', async () => {
      await assert.rejects(
        () => convex.mutation(
          'auth/users:deleteUserAccountByServer',
          {
            serverSecret: getInternalApiSecret(),
            userId: invitedUserId,
          },
          { throwOnError: true },
        ),
        /Transfer ownership of Acme/,
      )

      await convex.mutation(
        'auth/users:deleteUserAccountByServer',
        {
          serverSecret: getInternalApiSecret(),
          userId: ownerUserId,
        },
        { throwOnError: true },
      )
      assert.equal(await repository.getWorkspace(personalWorkspaceId), null)
      assert.equal(await repository.getAccess({
        workspaceId: orgWorkspaceId,
        userId: ownerUserId,
      }), null)
      const scrubbed = await repository.getPrincipal(ownerPrincipalId)
      assert.equal(scrubbed?.displayName, 'Deleted member')
      assert.equal(scrubbed?.userId, undefined)
      assert.ok(scrubbed?.archivedAt)
    })

    await t.test('organization archive is durable after member account deletion', async () => {
      assert.equal((await repository.archiveWorkspace({
        workspaceId: orgWorkspaceId,
        archivedByPrincipalId: invitedPrincipalId,
        now: Date.now(),
      }))?.status, 'archived')
      orgArchived = true
    })
  } finally {
    if (orgArchived) {
      await convex.mutation(
        'collaboration/workspaces:purgeArchivedWorkspaceByServer',
        {
          serverSecret: getInternalApiSecret(),
          workspaceId: orgWorkspaceId,
        },
        { throwOnError: true },
      ).catch(() => undefined)
    }
  }
})
