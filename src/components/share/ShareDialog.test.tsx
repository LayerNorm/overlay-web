import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  WorkspaceResourceGrant,
  WorkspaceShareDirectoryEntry,
  WorkspaceShareImpact,
} from '@overlay/workspace-contracts'
import { shareRoleOptions } from '@/shared/share/share-access-policy'
import { ShareDialogContent, shareDirectoryGroups } from './ShareDialog'

// Package components compile with the classic JSX runtime under the app's
// tsconfig, so they resolve React from the global.
;(globalThis as typeof globalThis & { React: typeof React }).React = React

const DIRECTORY: WorkspaceShareDirectoryEntry[] = [
  { id: 'principal_maya', name: 'Maya', kind: 'human', targetType: 'principal', description: 'maya@acme.test' },
  { id: 'principal_scout', name: 'Scout', kind: 'agent', targetType: 'principal' },
  { id: 'team_research', name: 'Research team', kind: 'team', targetType: 'team' },
  { id: 'conversation_research', name: '#research', kind: 'channel', targetType: 'room' },
]

const TEAM_GRANT: WorkspaceResourceGrant = {
  id: 'grant_team',
  workspaceId: 'workspace_acme',
  resourceType: 'file',
  resourceId: 'file_1',
  targetType: 'team',
  targetId: 'team_research',
  accessRole: 'editor',
  grantedByPrincipalId: 'principal_owner',
  createdAt: 0,
  updatedAt: 0,
}

const IMPACT: WorkspaceShareImpact = {
  targetName: 'Research team',
  targetType: 'team',
  dynamic: true,
  gaining: [{ principalId: 'principal_scout', name: 'Scout', kind: 'agent', via: 'Research team' }],
  retaining: [{ principalId: 'principal_maya', name: 'Maya', kind: 'human', via: 'Research team' }],
  losing: [],
}

function render(overrides: Partial<Parameters<typeof ShareDialogContent>[0]> = {}) {
  return renderToStaticMarkup(
    <ShareDialogContent
      resourceType="file"
      resourceTitle="Admissions research"
      hasResourceId
      publicLinksEnabled
      grants={[]}
      entriesByKey={new Map(DIRECTORY.map((entry) => [`${entry.targetType}:${entry.id}`, entry]))}
      available={DIRECTORY}
      loading={false}
      busy={false}
      notice={null}
      copied={false}
      canInvite={false}
      inviteEmail=""
      pending={null}
      target=""
      role="viewer"
      onTargetChange={() => undefined}
      onRoleChange={() => undefined}
      onRequestGrant={() => undefined}
      onChangeRole={() => undefined}
      onRequestRevoke={() => undefined}
      onConfirmPending={() => undefined}
      onCancelPending={() => undefined}
      onInviteEmailChange={() => undefined}
      onInvite={() => undefined}
      onCopyLink={() => undefined}
      {...overrides}
    />,
  )
}

test('share dialog renders loading, empty, and populated access states', () => {
  assert.match(render({ loading: true }), /share-dialog-loading/)
  assert.match(render(), /share-dialog-empty/)
  const populated = render({ grants: [TEAM_GRANT] })
  assert.match(populated, /Research team/)
  assert.match(populated, /Everyone on this team, including people added later/)
})

// The pickers use the shared listbox Select, which renders its options only
// when opened, so these assert the option data the pickers are built from.
test('share dialog groups people, agents, teams, and rooms in one picker', () => {
  assert.match(render(), /aria-label="Add a person, agent, team, or room"/)
  const groups = shareDirectoryGroups(DIRECTORY)
  assert.deepEqual(groups.map(({ label }) => label), ['People & agents', 'Teams', 'Rooms'])
  for (const { entries } of groups) assert.ok(entries.length > 0)
  assert.equal(groups.flatMap(({ entries }) => entries).length, DIRECTORY.length)
})

test('share dialog offers only permissions the API accepts for the resource', () => {
  const labels = (type: Parameters<typeof shareRoleOptions>[0]) =>
    shareRoleOptions(type).map(({ label }) => label)
  assert.match(render(), /Can view/)

  assert.ok(labels('file').includes('Can view'))
  assert.ok(labels('file').includes('Can edit'))
  assert.ok(!labels('file').includes('Can run'))
  assert.ok(labels('automation').includes('Can run'))
  assert.ok(labels('conversation').includes('Can view'))
  assert.ok(!labels('conversation').includes('Can edit'))
})

test('share dialog discloses who gains access before a dynamic grant exists', () => {
  const html = render({
    pending: { kind: 'grant', targetKey: 'team:team_research', accessRole: 'viewer', impact: IMPACT },
  })
  assert.match(html, /share-dialog-confirmation/)
  assert.match(html, /Share this file with Research team\?/)
  assert.match(html, /Gaining access/)
  assert.match(html, /Scout/)
  assert.match(html, /Already has access another way/)
  assert.match(html, /This list changes with membership/)
  assert.match(html, /Share with everyone listed/)
})

test('share dialog warns who loses access before a revocation', () => {
  const html = render({
    grants: [TEAM_GRANT],
    pending: {
      kind: 'revoke',
      grant: TEAM_GRANT,
      impact: {
        ...IMPACT,
        gaining: [],
        losing: [{ principalId: 'principal_scout', name: 'Scout', kind: 'agent' }],
        retaining: [],
      },
    },
  })
  assert.match(html, /Remove Research team’s access\?/)
  assert.match(html, /Losing access/)
  assert.match(html, /open downloads, streams, and agent tool calls/)
  assert.match(html, /Remove access/)
})

test('general access reflects workspace public-link policy', () => {
  const enabled = render({ publicUrl: 'https://overlay.test/share/f/token' })
  assert.match(enabled, /Anyone with the link/)
  assert.match(enabled, /Copy link/)
  assert.match(enabled, /redacts attachments that are not public themselves/)

  const restricted = render()
  assert.match(restricted, /Restricted/)
  assert.doesNotMatch(restricted, /Copy link/)

  const disabled = render({
    publicLinksEnabled: false,
    publicUrl: 'https://overlay.test/share/f/token',
  })
  assert.match(disabled, /Public links are off for this workspace/)
  assert.match(disabled, /Workspace settings → Sharing &amp; links/)
  assert.doesNotMatch(disabled, /Copy link/)
})

test('guest invitation appears only for workspace managers', () => {
  assert.doesNotMatch(render(), /Invite as guest/)
  assert.match(render({ canInvite: true }), /Invite as guest/)
})

test('share dialog surfaces failures instead of failing silently', () => {
  const html = render({ notice: 'Could not grant access' })
  assert.match(html, /share-dialog-notice/)
  assert.match(html, /Could not grant access/)
})
