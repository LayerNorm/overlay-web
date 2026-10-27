import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildWorkspaceHandleHref } from '@/shared/workspaces/routing'
import {
  ConversationDetailScopeGate,
  conversationDetailRouteKey,
  startConversationDetailScopeProbe,
  type ConversationDetailScopeStatus,
  type ConversationRouteLocation,
  type ConversationScopeDetail,
} from './conversationScopeVerification'
import type { WorkspaceHrefBuilder } from '@/hooks/use-workspace-href'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const buildWorkspaceHref: WorkspaceHrefBuilder = (_workspaceId, href, scope) => (
  buildWorkspaceHandleHref('team', href, scope)
)

function renderGate(routeKey: string | null, status: ConversationDetailScopeStatus | null, label = 'Conversation') {
  return renderToStaticMarkup(
    <ConversationDetailScopeGate
      routeKey={routeKey}
      status={status}
      fallback={<span>Conversation unavailable</span>}
    >
      <span>{label}</span>
    </ConversationDetailScopeGate>,
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function waitForProbe() {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

test('draft collaboration details are probed before the real conversation renders', async () => {
  const params = new URLSearchParams('id=dm-1&view=dms&draft=1&title=Fresh')
  const routeKey = conversationDetailRouteKey({
    pathScope: 'workspace',
    conversationId: params.get('id'),

  })
  assert.equal(routeKey, 'workspace:dm-1')
  assert.equal(renderGate(routeKey, null), '')

  let calls = 0
  const statuses: ConversationDetailScopeStatus[] = []
  const location: ConversationRouteLocation = {
    pathname: '/w/team/workspace/chat',
    search: `?${params.toString()}`,
    hash: '#message-1',
  }
  const cancel = startConversationDetailScopeProbe({
    routeKey: routeKey!,
    conversationId: 'dm-1',
    pathScope: 'workspace',
    pathname: location.pathname,
    getConversation: async () => {
      calls += 1
      return { conversationType: 'dm', scope: 'workspace' }
    },
    getLocation: () => location,
    buildWorkspaceHref,
    replace: () => assert.fail('the already-canonical draft URL should not redirect'),
    setStatus: (status) => statuses.push(status),
  })
  await waitForProbe()
  cancel()

  assert.equal(calls, 1)
  assert.deepEqual(statuses, [{ routeKey, status: 'verified' }])
  assert.match(renderGate(routeKey, statuses[0]!), /Conversation/)
})

test('draft markers do not bypass authorization for unknown conversation ids', async () => {
  const params = new URLSearchParams('id=unknown&view=dms&draft=1')
  const routeKey = conversationDetailRouteKey({
    pathScope: 'workspace',
    conversationId: params.get('id'),

  })
  const statuses: ConversationDetailScopeStatus[] = []
  const location: ConversationRouteLocation = {
    pathname: '/w/team/workspace/chat',
    search: `?${params.toString()}`,
    hash: '',
  }
  const cancel = startConversationDetailScopeProbe({
    routeKey: routeKey!,
    conversationId: 'unknown',
    pathScope: 'workspace',
    pathname: location.pathname,
    getConversation: async () => { throw new Error('not authorized') },
    getLocation: () => location,
    buildWorkspaceHref,
    replace: () => assert.fail('unavailable resources must not redirect'),
    setStatus: (status) => statuses.push(status),
  })
  await waitForProbe()
  cancel()

  assert.deepEqual(statuses, [{ routeKey, status: 'unavailable' }])
  assert.match(renderGate(routeKey, statuses[0]!), /Conversation unavailable/)
})

test('authorized details in the wrong scope redirect with hash and remain gated', async () => {
  const params = new URLSearchParams('id=dm-1&view=personal&draft=1&title=Fresh')
  const routeKey = conversationDetailRouteKey({
    pathScope: 'personal',
    conversationId: params.get('id'),

  })
  const location: ConversationRouteLocation = {
    pathname: '/w/team/personal/chat',
    search: `?${params.toString()}`,
    hash: '#message-1',
  }
  const statuses: ConversationDetailScopeStatus[] = []
  const destinations: string[] = []
  const cancel = startConversationDetailScopeProbe({
    routeKey: routeKey!,
    conversationId: 'dm-1',
    pathScope: 'personal',
    pathname: location.pathname,
    getConversation: async () => ({ conversationType: 'dm', scope: 'workspace' }),
    getLocation: () => location,
    buildWorkspaceHref,
    replace: (destination) => destinations.push(destination),
    setStatus: (status) => statuses.push(status),
  })
  await waitForProbe()
  cancel()

  assert.equal(destinations.length, 1)
  const destination = new URL(destinations[0]!, 'https://workspace.invalid')
  assert.equal(destination.pathname, '/w/team/workspace/chat')
  assert.equal(destination.searchParams.get('id'), 'dm-1')
  assert.equal(destination.searchParams.get('view'), 'dms')
  assert.equal(destination.searchParams.get('draft'), '1')
  assert.equal(destination.searchParams.get('title'), 'Fresh')
  assert.equal(destination.hash, '#message-1')
  assert.deepEqual(statuses, [])
  assert.equal(renderGate(routeKey, null), '')
})

test('a cancelled A-to-B detail probe cannot replace or overwrite B verification', async () => {
  const locationA: ConversationRouteLocation = {
    pathname: '/w/team/personal/chat',
    search: '?id=conversation-a&view=personal',
    hash: '#a',
  }
  const locationB: ConversationRouteLocation = {
    pathname: '/w/team/workspace/chat',
    search: '?id=conversation-b&view=dms',
    hash: '#b',
  }
  const pendingA = deferred<ConversationScopeDetail>()
  const statuses: ConversationDetailScopeStatus[] = []
  const replacementsA: string[] = []
  const cancelA = startConversationDetailScopeProbe({
    routeKey: 'personal:conversation-a',
    conversationId: 'conversation-a',
    pathScope: 'personal',
    pathname: locationA.pathname,
    getConversation: () => pendingA.promise,
    getLocation: () => locationA,
    buildWorkspaceHref,
    replace: (destination) => replacementsA.push(destination),
    setStatus: (status) => statuses.push(status),
  })

  cancelA()
  const cancelB = startConversationDetailScopeProbe({
    routeKey: 'workspace:conversation-b',
    conversationId: 'conversation-b',
    pathScope: 'workspace',
    pathname: locationB.pathname,
    getConversation: async () => ({ conversationType: 'dm', scope: 'workspace' }),
    getLocation: () => locationB,
    buildWorkspaceHref,
    replace: () => assert.fail('B is already in its actual view'),
    setStatus: (status) => statuses.push(status),
  })
  await waitForProbe()
  pendingA.resolve({ conversationType: 'dm', scope: 'workspace' })
  await waitForProbe()
  cancelB()

  assert.deepEqual(statuses, [{ routeKey: 'workspace:conversation-b', status: 'verified' }])
  assert.deepEqual(replacementsA, [])
})
