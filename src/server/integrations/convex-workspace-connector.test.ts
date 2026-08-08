import 'server-only'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { ConvexWorkspaceConnectorRepository } from './ConvexWorkspaceConnectorRepository'
import { ConvexWorkspaceRepository } from '@/server/workspaces/ConvexWorkspaceRepository'

const enabled = process.env.WORKSPACE_CONTRACT_CONVEX === '1'
const hasConvexUrl = Boolean(
  process.env.DEV_NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL,
)
const hasInternalSecret = Boolean(process.env.INTERNAL_API_SECRET?.trim())

test('Convex connector mappings require active workspace membership and upsert by compound key', {
  skip: enabled && hasConvexUrl && hasInternalSecret
    ? false
    : 'Set WORKSPACE_CONTRACT_CONVEX=1 plus Convex URL and INTERNAL_API_SECRET',
}, async () => {
  const workspaces = new ConvexWorkspaceRepository()
  const connectors = new ConvexWorkspaceConnectorRepository()
  const scope = `connector_${randomUUID().replaceAll('-', '')}`
  const workspaceId = `${scope}_workspace`
  const ownerUserId = `${scope}_owner`
  const ownerPrincipalId = `${scope}_owner_principal`

  await workspaces.createOrganization({
    workspaceId,
    ownerPrincipalId,
    actorUserId: ownerUserId,
    ownerDisplayName: 'Connector owner',
    ownerEmail: `${ownerUserId}@example.com`,
    name: `Connector test ${scope}`,
    slug: workspaceId,
    now: Date.now(),
  })

  try {
    const firstId = await connectors.insert({
      workspaceId,
      userId: ownerUserId,
      providerKey: 'gmail',
      connectedAccountId: `${scope}_account_1`,
    })
    const repeatedId = await connectors.insert({
      workspaceId,
      userId: ownerUserId,
      providerKey: 'gmail',
      connectedAccountId: `${scope}_account_2`,
    })

    assert.equal(repeatedId, firstId)
    assert.equal((await connectors.listByWorkspace({ workspaceId, userId: ownerUserId })).length, 1)
    await assert.rejects(
      () => connectors.listByWorkspace({ workspaceId, userId: `${scope}_outsider` }),
      /WORKSPACE_ACCESS_DENIED/,
    )
  } finally {
    await connectors.removeByUser({ userId: ownerUserId }).catch(() => undefined)
    await workspaces.archiveWorkspace({
      workspaceId,
      archivedByPrincipalId: ownerPrincipalId,
      now: Date.now(),
    }).catch(() => undefined)
  }
})
