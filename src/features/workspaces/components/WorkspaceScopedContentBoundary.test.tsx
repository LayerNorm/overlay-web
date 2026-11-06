import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import React, { act, useEffect, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkspaceScopedContentGate } from './WorkspaceScopedContentBoundary'
import { workspaceRouteRequiresSignIn } from './WorkspaceSignInPrompt'
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

      }}
    >
      <span>Scoped page</span>
    </WorkspaceScopedContentGate>,
  )
}

test('account and unknown routes are not held behind scope canonicalization', () => {
  const account = renderBoundary('/app/chat', 'section=account')
  assert.match(account, /Scoped page/)
  assert.doesNotMatch(account, /Opening workspace/)

  const unknown = renderBoundary('/app/unknown-surface', '')
  assert.match(unknown, /Scoped page/)
  assert.doesNotMatch(unknown, /Opening workspace/)
})

test('settled anonymous workspace routes show sign-in rather than waiting for disabled workspace hydration', () => {
  for (const [pathname, routeSearch] of [
    ['/app/agents/native-agent%3Aexample', ''],
    ['/app/chat', 'view=dms&id=room'],
    ['/app/w/workspace-1/chat', 'view=channels&id=room'],
  ]) {
    const html = renderToStaticMarkup(<WorkspaceScopedContentGate fallback={<span>Opening workspace</span>} state={{
      auth: { loading: false, hasUser: false }, switchingWorkspaceId: null, waitingForNavigation: false,
      routeTarget: readWorkspaceRouteTarget(pathname), status: 'idle', currentWorkspace: null, resolvedRouteTargetKey: null,
      descriptor: readWorkspaceRouteDescriptor(pathname), routeWorkspaceId: null, activeWorkspaceId: null, pathname, routeSearch, currentScope: 'workspace',
    }}><span>Private page</span></WorkspaceScopedContentGate>)
    assert.match(html, /Sign in to continue/)
    assert.match(html, /\/auth\/sign-in\?redirect=/)
    assert.doesNotMatch(html, /Opening workspace|Private page/)
  }
})

test('anonymous unscoped personal, account and unknown surfaces retain their own auth behavior', () => {
  expectNoWorkspaceSignIn('/app/chat', '')
  expectNoWorkspaceSignIn('/app/chat', 'view=personal&id=personal')
  expectNoWorkspaceSignIn('/app/chat', 'section=account')
  expectNoWorkspaceSignIn('/app/unknown-surface', '')
  function expectNoWorkspaceSignIn(pathname: string, search: string) { assert.equal(workspaceRouteRequiresSignIn(pathname, search), false) }
})

test('legacy scoped routes remain gated until a confirmed handle redirect is applied', () => {
  const html = renderBoundary('/app/chat', '')
  assert.match(html, /Opening workspace/)
  assert.doesNotMatch(html, /Scoped page/)
})

test('legacy and immutable-ID personal routes remain usable without a confirmed handle', () => {
  const legacy = renderBoundary('/app/chat', '', null)
  assert.match(legacy, /Scoped page/)
  assert.doesNotMatch(legacy, /Opening workspace/)

  const personalId = renderBoundary('/app/w/workspace-1/chat', 'scope=personal', null)
  assert.match(personalId, /Scoped page/)
  assert.doesNotMatch(personalId, /Opening workspace/)
})

test('rejected activation preserves hidden source state, but a target route discards it', async (t) => {
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  t.after(() => {
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
  const { create } = createRequire(import.meta.url)('react-test-renderer') as {
    create(element: React.ReactElement): {
      root: { findByType(type: string): { props: { onClick: () => void } } }
      update(element: React.ReactElement): void
      toJSON(): unknown
      unmount(): void
    }
  }
  let mounts = 0
  const recordMount = () => { mounts += 1 }
  function SourcePage() {
    const [draft, updateDraft] = useState('')
    useEffect(recordMount, [recordMount])
    return <button type="button" onClick={() => updateDraft('Unsent source draft')}>{draft}</button>
  }
  function stateFor(workspaceId: string) {
    const pathname = `/app/w/${workspaceId}/chat`
    const routeTarget = readWorkspaceRouteTarget(pathname)
    return {
      switchingWorkspaceId: null,
      waitingForNavigation: false,
      routeTarget,
      status: 'ready' as const,
      currentWorkspace: { id: workspaceId, slug: workspaceId } as WorkspaceSummary,
      resolvedRouteTargetKey: routeTarget ? workspaceRouteTargetKey(routeTarget) : null,
      descriptor: readWorkspaceRouteDescriptor(pathname),
      routeWorkspaceId: workspaceId,
      activeWorkspaceId: workspaceId,
      pathname,
      routeSearch: 'scope=personal',
      currentScope: 'personal' as const,
    }
  }
  const source = stateFor('source')
  const target = stateFor('target')
  const render = (state: React.ComponentProps<typeof WorkspaceScopedContentGate>['state']) => (
    <WorkspaceScopedContentGate state={state} fallback={<span>Opening workspace</span>}>
      <SourcePage />
    </WorkspaceScopedContentGate>
  )
  let tree!: ReturnType<typeof create>
  await act(() => { tree = create(render(source)) })
  t.after(async () => { await act(() => tree.unmount()) })
  await act(() => { tree.root.findByType('button').props.onClick() })
  await act(() => { tree.update(render({ ...source, switchingWorkspaceId: 'target' })) })
  assert.equal(mounts, 1)
  assert.match(JSON.stringify(tree.toJSON()), /"hidden":true/)
  assert.match(JSON.stringify(tree.toJSON()), /"inert":true/)
  assert.match(JSON.stringify(tree.toJSON()), /Opening workspace/)

  await act(() => { tree.update(render(source)) })
  assert.match(JSON.stringify(tree.toJSON()), /Unsent source draft/)
  assert.equal(mounts, 1)
  assert.match(JSON.stringify(tree.toJSON()), /"hidden":false/)
  assert.doesNotMatch(JSON.stringify(tree.toJSON()), /Opening workspace/)

  await act(() => {
    tree.update(render({
      ...target,
      activeWorkspaceId: source.activeWorkspaceId,
      resolvedRouteTargetKey: source.resolvedRouteTargetKey,
    }))
  })
  assert.doesNotMatch(JSON.stringify(tree.toJSON()), /Unsent source draft/)
  assert.match(JSON.stringify(tree.toJSON()), /Opening workspace/)
  await act(() => { tree.update(render(target)) })
  assert.equal(mounts, 2)
  assert.doesNotMatch(JSON.stringify(tree.toJSON()), /Unsent source draft/)
})
