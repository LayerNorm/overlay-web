import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SyncSettingsView, type SyncSettingsViewProps } from './SyncSettingsPanel'
import { syncUrls, type SyncLinkRow, type SyncProviderStatus, type SyncStatus } from '../lib/sync-settings'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const DAY = 24 * 60 * 60 * 1000
const noop = () => undefined
const actions: SyncSettingsViewProps['actions'] = {
  onProviderChange: noop, onOpenImport: noop, onDisconnect: noop, onDisconnectAccount: noop, onDmSync: noop,
  onAutoLink: noop, onTogglePicker: noop, onPickerTargetChange: noop, onLink: noop, onUnlink: noop,
}

function link(overrides: Partial<SyncLinkRow>): SyncLinkRow {
  return {
    linkId: 'l-' + (overrides.externalChannelId ?? 'C1'), externalChannelId: 'C1', externalChannelName: 'general', externalChannelKind: 'public',
    conversationId: 'c1', status: 'syncing', createdAt: 200 * DAY, overlayChannelName: 'general', overlayChannelVisibility: 'public',
    ...overrides,
  }
}

const connectedSlack: SyncProviderStatus = {
  provider: 'slack',
  connection: { externalOrgName: 'LayerNorm Slack', status: 'connected', autoLink: false, connectedAt: Date.UTC(2026, 10, 10, 12), connectedByName: 'Divyansh' },
  account: null,
  links: [
    link({}),
    link({ externalChannelId: 'C2', externalChannelName: 'eng-platform', externalChannelKind: 'private', overlayChannelName: 'eng-platform', overlayChannelVisibility: 'private', status: 'history', historyTargetAt: 20 * DAY, historyOldestAt: 110 * DAY }),
    link({ externalChannelId: 'C3', externalChannelName: 'customer-acme', externalChannelKind: 'shared', overlayChannelName: 'customer-acme', status: 'catching_up', catchUpUntil: 120_000 }),
    link({ externalChannelId: 'C4', externalChannelName: 'old', overlayChannelName: 'old', status: 'paused', pauseReason: 'not_in_channel' }),
  ],
}
const emptyTeams: SyncProviderStatus = { provider: 'teams', connection: null, account: null, links: [] }

function render(overrides: Partial<SyncSettingsViewProps> & { status?: SyncStatus | null }) {
  return renderToStaticMarkup(
    <SyncSettingsView
      provider="slack"
      status={{ canManage: true, providers: [connectedSlack, emptyTeams] }}
      unavailable={false}
      urls={syncUrls(overrides.provider ?? 'slack', '/app/settings?section=workspace&workspace_tab=import', 'ws')}
      busy={null}
      picker={null}
      pickerTarget=""
      linkTargets={[]}
      now={0}
      actions={actions}
      {...overrides}
    />,
  )
}

test('loading, error and unavailable states keep the provider switch', () => {
  const loading = render({ status: undefined })
  assert.match(loading, /data-testid="sync-loading"/)
  assert.match(loading, /Microsoft Teams/)
  assert.match(loading, /One-time import/)
  assert.match(render({ status: null }), /Sync settings aren’t available/)
  const unavailable = render({ provider: 'teams', unavailable: true })
  assert.match(unavailable, /Microsoft Teams sync isn’t available yet/)
  assert.doesNotMatch(unavailable, /sync-org-card/)
})

test('a connected workspace shows who connected it and every link state', () => {
  const html = render({})
  assert.match(html, /LayerNorm Slack/)
  assert.match(html, /Connected Nov 10 by Divyansh/)
  assert.match(html, /aria-label="Connection options"/)
  assert.match(html, />Syncing</)
  assert.match(html, /Importing history/)
  assert.match(html, /50% of the last 180 days/)
  assert.match(html, /aria-valuenow="50"/)
  assert.match(html, /Catching up/)
  assert.match(html, /Resumes automatically in 2 min/)
  assert.match(html, /Paused/)
  assert.match(html, /Add Overlay to this channel in Slack to resume/)
  assert.equal(html.match(/>Unlink</g)?.length, 4)
  assert.match(html, /1 channel is paused/)
  assert.match(html, /Link channel/)
})

test('the account card connects, then offers direct message sync', () => {
  const disconnected = render({})
  assert.match(disconnected, /Connect your Slack account to reply from Overlay/)
  assert.match(disconnected, /href="\/api\/v1\/surfaces\/slack\/connect\?purpose=sync_member&amp;returnTo=/)
  assert.doesNotMatch(disconnected, /Sync my direct messages/)
  const connected = render({ status: { canManage: true, providers: [{ ...connectedSlack, account: { externalDisplayName: 'Divyansh', dmSyncEnabled: true } }, emptyTeams] } })
  assert.match(connected, /Connected as Divyansh/)
  assert.match(connected, /aria-label="Account options"/)
  assert.match(connected, /aria-label="Sync my direct messages"[^>]*aria-checked="true"|aria-checked="true"[^>]*aria-label="Sync my direct messages"/)
})

test('members see workspace sync read-only but can still connect their own account', () => {
  const html = render({ status: { canManage: false, providers: [connectedSlack, emptyTeams] } })
  assert.match(html, /Only owners and admins can change workspace sync settings/)
  assert.doesNotMatch(html, /Connection options/)
  assert.doesNotMatch(html, /Link channel/)
  assert.doesNotMatch(html, />Unlink</)
  assert.match(html, /role="switch"[^>]*disabled=""[^>]*aria-label="Auto-link new public channels"|aria-label="Auto-link new public channels"[^>]*disabled=""/)
  assert.match(html, /purpose=sync_member/)
})

test('an unconnected Teams organization offers Connect and the app package', () => {
  const owner = render({ provider: 'teams' })
  assert.match(owner, /href="\/api\/v1\/sync\/teams\/connect\?returnTo=/)
  assert.match(owner, /aria-label="Connection options"/)
  assert.match(owner, /Connect Microsoft Teams to link channels/)
  assert.match(owner, /Available once Microsoft Teams is connected/)
  const member = render({ provider: 'teams', status: { canManage: false, providers: [connectedSlack, emptyTeams] } })
  assert.match(member, /An owner or admin can connect it/)
  assert.doesNotMatch(member, /teams\/connect\?/)
})

test('the channel picker loads, fails and lists channels with their Overlay target', () => {
  assert.match(render({ picker: { status: 'loading' } }), /Loading channels/)
  assert.match(render({ picker: { status: 'error', message: 'Slack is busy' } }), /Slack is busy/)
  const ready = render({
    picker: { status: 'ready', channels: [
      { id: 'C1', name: 'general', kind: 'public' },
      { id: 'C9', name: 'design', kind: 'public' },
      { id: 'C8', name: 'sales', kind: 'private' },
    ] },
  })
  const pickerHtml = ready.slice(ready.indexOf('sync-channel-picker'), ready.indexOf('role="table"'))
  assert.match(pickerHtml, />design</)
  assert.doesNotMatch(pickerHtml, />general</)
  assert.match(ready, /to new channel/)
  assert.match(ready, /to new private channel/)
  const intoPublic = render({
    picker: { status: 'ready', channels: [{ id: 'C8', name: 'sales', kind: 'private' }] },
    pickerTarget: 'c-design',
    linkTargets: [{ conversationId: 'c-design', name: 'design', visibility: 'public' }],
  })
  assert.match(intoPublic, /needs a private Overlay channel/)
  assert.match(intoPublic, /aria-label="Link into"/)
})
