import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { ConvexWorkspaceRepository } from '@/server/workspaces/ConvexWorkspaceRepository'
import { ConvexWorkspaceAgentRepository } from './ConvexWorkspaceAgentRepository'

const enabled = process.env.WORKSPACE_CONTRACT_CONVEX === '1'
const hasConvexUrl = Boolean(process.env.DEV_NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL)
const hasInternalSecret = Boolean(process.env.INTERNAL_API_SECRET?.trim())

test('Convex named agents match the Postgres identity and archive contract', {
  skip: enabled && hasConvexUrl && hasInternalSecret
    ? false
    : 'Set WORKSPACE_CONTRACT_CONVEX=1 plus Convex URL and INTERNAL_API_SECRET',
}, async () => {
  const workspaces = new ConvexWorkspaceRepository()
  const agents = new ConvexWorkspaceAgentRepository()
  const scope = `agent_${randomUUID().replaceAll('-', '')}`
  const userId = `${scope}_user`
  const workspaceId = `${scope}_workspace`
  const ownerPrincipalId = `${scope}_owner`
  const agentId = `${scope}_definition`
  const principalId = `${scope}_principal`
  let archived = false
  try {
    await workspaces.createOrganization({
      workspaceId, ownerPrincipalId, actorUserId: userId, ownerDisplayName: 'Owner',
      name: 'Agent contracts', slug: workspaceId, now: Date.now(),
    })
    const team = await workspaces.createTeam({
      id: `${scope}_team`, workspaceId, name: 'Research', createdByPrincipalId: ownerPrincipalId, now: Date.now(),
    })
    const created = await agents.create({
      agentId, principalId, workspaceId, name: 'Scout', description: 'Finds evidence',
      instructions: 'Find primary evidence and cite it.', harness: 'overlay', modelId: 'openrouter/free',
      avatarColor: '#2563eb', allowedToolIds: ['web.search'], teamIds: [team.id],
      visibility: 'creator', createdByPrincipalId: ownerPrincipalId, now: Date.now(),
    })
    assert.equal(created.principalId, principalId)
    assert.equal(created.visibility, 'creator')
    assert.deepEqual(created.teamIds, [team.id])
    // Creator-only agents join no channels implicitly.
    assert.equal(created.roomCount, 0)
    assert.equal((await workspaces.getPrincipal(principalId))?.agentId, agentId)
    assert.equal((await workspaces.getResourceWorkspace({ resourceType: 'agent', resourceId: agentId }))?.workspaceId, workspaceId)

    assert.equal((await agents.update({
      agentId, workspaceId, name: 'Scout Prime', instructions: 'Compare primary evidence.', now: Date.now(),
    }))?.name, 'Scout Prime')
    assert.equal((await agents.update({
      agentId, workspaceId, visibility: 'workspace', now: Date.now(),
    }))?.visibility, 'workspace')
    // Flipping to workspace-visible grants no retroactive channel joins.
    assert.equal((await agents.get({ agentId, workspaceId }))?.roomCount, 0)
    // A workspace-visible agent still auto-joins public channels on create.
    const sharedAgentId = `${scope}_shared`
    const shared = await agents.create({
      agentId: sharedAgentId, principalId: `${scope}_shared_principal`, workspaceId,
      name: 'Herald', description: 'Announces releases',
      instructions: 'Announce releases briefly.', harness: 'overlay', modelId: 'openrouter/free',
      allowedToolIds: [], teamIds: [], visibility: 'workspace',
      createdByPrincipalId: ownerPrincipalId, now: Date.now(),
    })
    assert.equal(shared.roomCount, 1)
    assert.equal(await agents.archive({ agentId, workspaceId, now: Date.now() }), true)
    assert.equal(await agents.archive({ agentId: sharedAgentId, workspaceId, now: Date.now() }), true)
    assert.equal((await agents.list({ workspaceId })).length, 0)
    assert.equal((await workspaces.getMembership({ workspaceId, principalId }))?.status, 'suspended')
    await workspaces.archiveWorkspace({ workspaceId, archivedByPrincipalId: ownerPrincipalId, now: Date.now() })
    archived = true
  } finally {
    if (archived) {
      await convex.mutation(
        'collaboration/workspaces:purgeArchivedWorkspaceByServer',
        { serverSecret: getInternalApiSecret(), workspaceId },
        { throwOnError: true },
      )
    }
  }
})
