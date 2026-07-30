import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkspaceManagementContent, WorkspaceSharingPolicySection } from './WorkspaceSettingsPanel'

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

test('sharing & links renders policy lifecycle states', () => {
  const loading = renderToStaticMarkup(
    <WorkspaceSharingPolicySection state={{ status: 'loading' }} />,
  )
  const error = renderToStaticMarkup(
    <WorkspaceSharingPolicySection
      state={{ status: 'error', message: 'Request failed' }}
      onRetry={() => undefined}
    />,
  )

  assert.match(loading, /Loading sharing &amp; links/)
  assert.match(error, /data-testid="workspace-sharing-policy-error"/)
  assert.match(error, /Request failed/)
  assert.match(error, /Try again/)
})

test('public links can be turned off by managers and are read-only for members', () => {
  const managerEnabled = renderToStaticMarkup(
    <WorkspaceSharingPolicySection
      state={{ status: 'ready', publicLinksEnabled: true, canManage: true, updatedAt: 0 }}
      onToggle={() => undefined}
    />,
  )
  assert.match(managerEnabled, /data-testid="workspace-sharing-policy"/)
  assert.match(managerEnabled, /Allowed for this workspace/)
  assert.match(managerEnabled, /Turn off/)
  assert.match(managerEnabled, /redact attachments that are not public themselves/)

  const managerDisabled = renderToStaticMarkup(
    <WorkspaceSharingPolicySection
      state={{ status: 'ready', publicLinksEnabled: false, canManage: true, updatedAt: 0 }}
      onToggle={() => undefined}
    />,
  )
  assert.match(managerDisabled, /Blocked for this workspace/)
  assert.match(managerDisabled, /Turn on/)

  const member = renderToStaticMarkup(
    <WorkspaceSharingPolicySection
      state={{ status: 'ready', publicLinksEnabled: true, canManage: false, updatedAt: 0 }}
      onToggle={() => undefined}
    />,
  )
  assert.match(member, /disabled/)
  assert.match(member, /Only owners and admins can change workspace policy/)
})
