import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkspaceScopedContentGate } from './WorkspaceScopedContentBoundary'
import {
  readWorkspaceRouteDescriptor,
  readWorkspaceRouteTarget,
  workspaceRouteTargetKey,
} from '@/shared/workspaces/routing'
import type { WorkspaceSummary } from '@/shared/workspaces/types'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

function renderBoundary(
  pathname: string,
  search: string,
  showcase = false,
  routingHandle: string | null = 'team',
) {
  const routeTarget = readWorkspaceRouteTarget(pathname)
  const currentWorkspace = {
    id: 'workspace-1',
    slug: 'team',
    ...(routingHandle ? { routingHandle } : {}),
  } as WorkspaceSummary
  return renderToStaticMarkup(
    <WorkspaceScopedContentGate
      fallback={<span>Opening workspace</span>}
      state={{
        switchingWorkspaceId: null,
        waitingForNavigation: false,
        routeTarget,
        status: 'ready',
        currentWorkspace,
        resolvedRouteTargetKey: routeTarget?.kind === 'id' && routeTarget.value === currentWorkspace.id
          ? workspaceRouteTargetKey(routeTarget)
          : null,
        descriptor: readWorkspaceRouteDescriptor(pathname),
        routeWorkspaceId: routeTarget?.kind === 'id' ? routeTarget.value : null,
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

test('legacy scoped routes remain gated until a confirmed handle redirect is applied', () => {
  const html = renderBoundary('/app/chat', '')
  assert.match(html, /Opening workspace/)
  assert.doesNotMatch(html, /Scoped page/)
})

test('legacy and immutable-ID personal routes remain usable without a confirmed handle', () => {
  const legacy = renderBoundary('/app/chat', '', false, null)
  assert.match(legacy, /Scoped page/)
  assert.doesNotMatch(legacy, /Opening workspace/)

  const personalId = renderBoundary('/app/w/workspace-1/chat', 'scope=personal', false, null)
  assert.match(personalId, /Scoped page/)
  assert.doesNotMatch(personalId, /Opening workspace/)
})
