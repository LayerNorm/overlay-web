import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkspaceScopedContentGate } from './WorkspaceScopedContentBoundary'
import { readWorkspaceRouteDescriptor, readWorkspaceRouteTarget } from '@/shared/workspaces/routing'
import type { WorkspaceSummary } from '@/shared/workspaces/types'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

function renderBoundary(pathname: string, search: string, showcase = false) {
  const currentWorkspace = { id: 'workspace-1', slug: 'team' } as WorkspaceSummary
  return renderToStaticMarkup(
    <WorkspaceScopedContentGate
      fallback={<span>Opening workspace</span>}
      state={{
        switchingWorkspaceId: null,
        waitingForNavigation: false,
        routeTarget: readWorkspaceRouteTarget(pathname),
        status: 'ready',
        currentWorkspace,
        resolvedRouteTargetKey: null,
        descriptor: readWorkspaceRouteDescriptor(pathname),
        routeWorkspaceId: null,
        activeWorkspaceId: currentWorkspace.id,
        pathname,
        routeSearch: search,
        currentScope: 'personal',
        showcase,
      }}
    >
      <span>Scoped page</span>
    </WorkspaceScopedContentGate>,
  )
}

test('showcase content is not held behind legacy scope canonicalization', () => {
  const html = renderBoundary('/app/chat', 'showcase=1', true)
  assert.match(html, /Scoped page/)
  assert.doesNotMatch(html, /Opening workspace/)
})

test('account and unknown routes are not held behind scope canonicalization', () => {
  const account = renderBoundary('/app/chat', 'section=account')
  assert.match(account, /Scoped page/)
  assert.doesNotMatch(account, /Opening workspace/)

  const unknown = renderBoundary('/app/unknown-surface', '')
  assert.match(unknown, /Scoped page/)
  assert.doesNotMatch(unknown, /Opening workspace/)
})

test('legacy scoped routes remain gated until the same canonical redirect decision is applied', () => {
  const html = renderBoundary('/app/chat', '')
  assert.match(html, /Opening workspace/)
  assert.doesNotMatch(html, /Scoped page/)
})
