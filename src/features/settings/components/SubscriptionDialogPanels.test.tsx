import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SubscriptionFooter, SubscriptionPrivacyNote, SubscriptionScopeSelector } from './SubscriptionDialogPanels'
import { subscriptionAuthorizationBody, subscriptionRequest } from './subscription-connection-client'
import { ACTIVE_WORKSPACE_HEADER } from '@/shared/workspaces/constants'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

test('scope selector explains personal isolation and explicit workspace sharing', () => {
  const render = (scope: 'personal' | 'workspace', disabled = false, workspaceAvailable = true) => renderToStaticMarkup(
    <SubscriptionScopeSelector scope={scope} onScopeChange={() => {}} workspaceName="Acme" workspaceAvailable={workspaceAvailable} disabled={disabled} />,
  )
  assert.match(render('personal'), /Only you can use this connection/)
  assert.match(render('personal'), /aria-pressed="true"[^>]*>.*?Personal/)
  assert.match(render('workspace'), /Members of the Acme workspace can use this connection/)
  assert.match(render('workspace', true), /<fieldset[^>]*disabled/)
  assert.match(render('personal', false, false), /<button[^>]*disabled=""[^>]*>.*?Workspace/)
  const privacy = renderToStaticMarkup(<SubscriptionPrivacyNote />)
  assert.doesNotMatch(privacy, /stays personal|border-t/)
  assert.match(privacy, /will not switch to paid inference/)
})

test('Continue is disabled while the active workspace is unresolved', () => {
  const flow = {
    availability: { available: true, providers: [] },
    busy: false,
    connected: null,
    login: null,
    stopped: false,
  } as React.ComponentProps<typeof SubscriptionFooter>['flow']
  const selected = { enabled: true } as NonNullable<React.ComponentProps<typeof SubscriptionFooter>['selected']>
  const footer = renderToStaticMarkup(
    <SubscriptionFooter flow={flow} selected={selected} onClose={() => {}} onStart={() => {}} startDisabled />,
  )
  assert.match(footer, /<button[^>]*disabled=""[^>]*>.*?Continue/)
})

test('authorization includes explicit new scope, preserves reconnect scope, and pins the workspace header', async (t) => {
  assert.deepEqual(subscriptionAuthorizationBody('claude', 'personal'), { providerId: 'claude', scope: 'personal' })
  assert.deepEqual(subscriptionAuthorizationBody('claude', 'workspace'), { providerId: 'claude', scope: 'workspace' })
  assert.deepEqual(subscriptionAuthorizationBody('claude', 'personal', 'shared-connection'), { providerId: 'claude', connectionId: 'shared-connection' })
  const requests: RequestInit[] = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    requests.push(init)
    return Response.json({ data: { connectionId: 'new-connection' } })
  })
  await subscriptionRequest(subscriptionAuthorizationBody('claude', 'workspace'), { method: 'POST', workspaceId: 'workspace-a', idempotencyKey: 'request-1' })
  await subscriptionRequest({ action: 'poll', connectionId: 'new-connection' }, { workspaceId: 'workspace-a' })
  for (const request of requests) assert.equal(new Headers(request.headers).get(ACTIVE_WORKSPACE_HEADER), 'workspace-a')
  assert.equal(new Headers(requests[0].headers).get('Idempotency-Key'), 'request-1')
  assert.deepEqual(JSON.parse(String(requests[0].body)), { providerId: 'claude', scope: 'workspace' })
})
