import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceSummary } from '@overlay/workspace-contracts'
import { buildWorkspaceHrefForContext } from './use-workspace-href'
import { buildWorkspaceHandleHref, parseWorkspaceHandleRoute } from '@/shared/workspaces/routing'

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

test('onboarding task selection survives canonical and immutable-ID Work destinations', () => {
  for (const routingHandle of [undefined, 'team']) {
    const workspace = { ...baseWorkspace, routingHandle }
    const href = buildWorkspaceHrefForContext({
      workspaceId: workspace.id,
      href: '/app/work?task=first-task&scope=personal',
      scope: 'personal',
      currentScope: 'workspace',
      target: null,
      workspaces: [workspace],
      activeWorkspace: workspace,
    })
    const canonical = buildWorkspaceHandleHref('team', href)
    const url = new URL(canonical, 'https://overlay.invalid')
    assert.equal(url.pathname, '/w/team/personal/work')
    assert.equal(url.searchParams.get('task'), 'first-task')
    assert.equal(parseWorkspaceHandleRoute(url.pathname, url.search)?.scope, 'personal')
  }
})
