import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkspaceManagementContent } from './WorkspaceSettingsPanel'

const READY_STATE = {
  status: 'ready' as const,
  canManage: true,
  currentPrincipalId: 'principal_owner',
  currentRole: 'owner' as const,
  workspaceKind: 'organization' as const,
}

test('workspace settings renders loading, empty, and error lifecycle states', () => {
  const loading = renderToStaticMarkup(
    <WorkspaceManagementContent tab="people" state={{ status: 'loading' }} />,
  )
  const empty = renderToStaticMarkup(
    <WorkspaceManagementContent tab="teams" state={{ ...READY_STATE, items: [] }} />,
  )
  const error = renderToStaticMarkup(
    <WorkspaceManagementContent
      tab="guests"
      state={{ status: 'error', message: 'Request failed' }}
      onRetry={() => undefined}
    />,
  )

  assert.match(loading, /Loading people/)
  assert.match(empty, /data-testid="workspace-management-empty"/)
  assert.match(empty, /No teams yet/)
  assert.match(error, /data-testid="workspace-management-error"/)
  assert.match(error, /Request failed/)
  assert.match(error, /Try again/)
})

test('workspace settings renders populated rows with role detail', () => {
  const html = renderToStaticMarkup(
    <WorkspaceManagementContent
      tab="roles"
      state={{
        ...READY_STATE,
        items: [{
          id: 'owner',
          kind: 'role',
          name: 'Owner',
          description: 'Full workspace control',
          detail: '1 person',
          badge: 'built-in',
        }],
      }}
    />,
  )

  assert.match(html, /data-testid="workspace-management-list"/)
  assert.match(html, /Owner/)
  assert.match(html, /Full workspace control/)
  assert.match(html, /1 person/)
  assert.match(html, /built-in/)
})
