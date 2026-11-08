import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceSummary } from '@overlay/workspace-contracts'
import { buildWorkspaceHrefForContext } from './use-workspace-href'

const baseWorkspace: WorkspaceSummary = {
  id: 'workspace-1',
  name: 'Team',
  slug: 'team',
  kind: 'organization',
  status: 'active',
  role: 'owner',
}

function buildHref(workspace: WorkspaceSummary) {
  return buildWorkspaceHrefForContext({
    workspaceId: workspace.id,
    href: '/app/chat',
    currentScope: 'personal',
    target: null,
    workspaces: [workspace],
    activeWorkspace: workspace,
  })
}

test('workspace hrefs keep immutable-ID navigation until a handle is confirmed', () => {
  assert.equal(buildHref(baseWorkspace), '/app/w/workspace-1/chat?scope=personal')
})

test('workspace hrefs use a confirmed routing handle', () => {
  assert.equal(
    buildHref({ ...baseWorkspace, routingHandle: 'team' }),
    '/w/team/personal/chat?view=personal',
  )
})

test('archived chat links name their workspace so a full page load opens them there', () => {
  const href = (workspace: WorkspaceSummary) => buildWorkspaceHrefForContext({
    workspaceId: workspace.id,
    href: '/app/archived?id=chat-1',
    currentScope: 'workspace',
    target: null,
    workspaces: [workspace],
    activeWorkspace: workspace,
  })
  assert.equal(href({ ...baseWorkspace, routingHandle: 'team' }), '/w/team/archived?id=chat-1')
  assert.equal(href(baseWorkspace), '/app/w/workspace-1/archived?id=chat-1')
})
