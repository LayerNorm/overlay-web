import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceAccess } from '@overlay/workspace-contracts'
import { toWorkspaceSummaryWithRoutingHandle } from './presentation'

function access(): WorkspaceAccess {
  return {
    workspace: {
      id: 'workspace_1',
      kind: 'organization',
      name: 'Studio',
      slug: 'old-studio',
      status: 'active',
      createdByPrincipalId: 'principal_1',
      createdAt: 1,
      updatedAt: 1,
    },
    principal: {
      id: 'principal_1',
      workspaceId: 'workspace_1',
      type: 'human',
      userId: 'user_1',
      displayName: 'Member',
      createdAt: 1,
      updatedAt: 1,
    },
    membership: {
      workspaceId: 'workspace_1',
      principalId: 'principal_1',
      role: 'owner',
      status: 'active',
      joinedAt: 1,
      updatedAt: 1,
    },
  }
}

test('workspace summaries expose the canonical handle for the same resolved workspace', async () => {
  const summary = await toWorkspaceSummaryWithRoutingHandle({
    async resolveWorkspaceHandle({ userId, handle }) {
      assert.equal(userId, 'user_1')
      assert.equal(handle, 'old-studio')
      return { workspaceId: 'workspace_1', canonicalHandle: 'studio', canonical: false }
    },
  }, 'user_1', access(), { memberCount: 4 })

  assert.equal(summary.slug, 'old-studio')
  assert.equal(summary.routingHandle, 'studio')
  assert.equal(summary.memberCount, 4)
})

test('workspace summaries omit handles that resolve to a different workspace', async () => {
  const summary = await toWorkspaceSummaryWithRoutingHandle({
    async resolveWorkspaceHandle() {
      return { workspaceId: 'workspace_other', canonicalHandle: 'studio', canonical: true }
    },
  }, 'user_1', access())

  assert.equal(summary.slug, 'old-studio')
  assert.equal('routingHandle' in summary, false)
})

test('workspace summaries remain available when handle resolution is unavailable', async () => {
  const summary = await toWorkspaceSummaryWithRoutingHandle({
    async resolveWorkspaceHandle() {
      throw new Error('resolver unavailable')
    },
  }, 'user_1', access())

  assert.equal(summary.id, 'workspace_1')
  assert.equal(summary.slug, 'old-studio')
  assert.equal('routingHandle' in summary, false)
})

test('workspace summaries support services without a handle resolver', async () => {
  const summary = await toWorkspaceSummaryWithRoutingHandle(
    {} as Parameters<typeof toWorkspaceSummaryWithRoutingHandle>[0],
    'user_1',
    access(),
  )

  assert.equal(summary.slug, 'old-studio')
  assert.equal('routingHandle' in summary, false)
})
