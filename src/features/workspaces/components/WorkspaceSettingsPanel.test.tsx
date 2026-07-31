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
  // Primary actions live in the panel header, not a dedicated list toolbar row.
  assert.doesNotMatch(html, /Invite people/)
})

test('people list does not render a standalone invite toolbar row', () => {
  const html = renderToStaticMarkup(
    <WorkspaceManagementContent
      tab="people"
      state={{
        ...READY_STATE,
        items: [{
          id: 'role_member',
          kind: 'role',
          name: 'Members',
          description: 'Workspace collaborators',
          detail: '2 principals',
          badge: 'built-in',
        }],
      }}
      onPrimaryAction={() => undefined}
    />,
  )

  assert.match(html, /data-testid="workspace-management-list"/)
  assert.match(html, /Members/)
  assert.doesNotMatch(html, /Invite people/)
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

const READY_POLICY = {
  status: 'ready' as const,
  canManage: true,
  updatedAt: 0,
  publicLinksEnabled: true,
  memberCanCreateChannels: true,
  memberCanCreateAgents: true,
  memberCanInvite: false,
  legalHold: false,
  rolloutStage: 'general' as const,
}

test('public links can be turned off by managers and are read-only for members', () => {
  const managerEnabled = renderToStaticMarkup(
    <WorkspaceSharingPolicySection
      state={READY_POLICY}
      onToggle={() => undefined}
    />,
  )
  assert.match(managerEnabled, /data-testid="workspace-sharing-policy"/)
  assert.match(managerEnabled, /Allowed for this workspace/)
  assert.match(managerEnabled, /Turn off/)
  assert.match(managerEnabled, /redact attachments that are not public themselves/)

  const managerDisabled = renderToStaticMarkup(
    <WorkspaceSharingPolicySection
      state={{ ...READY_POLICY, publicLinksEnabled: false }}
      onToggle={() => undefined}
    />,
  )
  assert.match(managerDisabled, /Blocked for this workspace/)
  assert.match(managerDisabled, /Turn on/)

  const member = renderToStaticMarkup(
    <WorkspaceSharingPolicySection
      state={{ ...READY_POLICY, canManage: false }}
      onToggle={() => undefined}
    />,
  )
  assert.match(member, /disabled/)
  assert.match(member, /Only owners and admins can change workspace policy/)
})

test('governance panel exposes every workspace policy and its rollout state', () => {
  const html = renderToStaticMarkup(
    <WorkspaceSharingPolicySection
      state={{
        ...READY_POLICY,
        memberCanCreateChannels: false,
        memberCanInvite: true,
        legalHold: true,
        rolloutStage: 'invited',
        guestExpirationDays: 30,
        channelRetentionDays: 180,
      }}
      onToggle={() => undefined}
    />,
  )
  assert.match(html, /Members can create channels/)
  assert.match(html, /Owners and admins only/)
  assert.match(html, /Members can create agents/)
  assert.match(html, /Members may invite/)
  assert.match(html, /Legal hold/)
  assert.match(html, /Hold active — nothing is swept/)
  assert.match(html, /Invited workspaces/)
  assert.match(html, /30 days/)
  assert.match(html, /180 days/)
})

test('operational signals appear for managers and reveal provider parity', () => {
  const html = renderToStaticMarkup(
    <WorkspaceSharingPolicySection
      state={{
        ...READY_POLICY,
        metrics: {
          workspaceId: 'workspace_acme',
          collectedAt: 0,
          outboxPendingEvents: 4,
          outboxOldestPendingAgeMs: 1_500,
          failedDeliveries: 1,
          agentRunsQueued: 2,
          agentRunsFailed: 3,
          authorizationDenials: 5,
          invitationFailures: 6,
          unreadDriftConversations: 7,
          providerParity: { provider: 'postgres', requiresConvexClient: false },
        },
      }}
      onToggle={() => undefined}
    />,
  )
  assert.match(html, /workspace-operational-metrics/)
  assert.match(html, /Authorization denials/)
  assert.match(html, /Invitation failures/)
  assert.match(html, /Unread drift/)
  assert.match(html, /postgres/)
  assert.match(html, /Convex required/)

  const withoutMetrics = renderToStaticMarkup(
    <WorkspaceSharingPolicySection state={READY_POLICY} onToggle={() => undefined} />,
  )
  assert.doesNotMatch(withoutMetrics, /workspace-operational-metrics/)
})
