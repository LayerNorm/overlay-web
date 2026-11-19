import assert from 'node:assert/strict'
import test from 'node:test'
import { healthNote, historyProgress, linkStatusDetail, needsPrivateTarget, oauthReturnNotice, syncUrls, type SyncLinkRow } from './sync-settings'

const DAY = 24 * 60 * 60 * 1000

function link(overrides: Partial<SyncLinkRow>): SyncLinkRow {
  return {
    linkId: 'l1', externalChannelId: 'C1', externalChannelName: 'general', externalChannelKind: 'public',
    conversationId: 'c1', status: 'syncing', createdAt: 200 * DAY, overlayChannelName: 'general', overlayChannelVisibility: 'public',
    ...overrides,
  }
}

test('history progress runs from link creation back to the history target', () => {
  const base = { createdAt: 200 * DAY, historyTargetAt: 20 * DAY }
  assert.equal(historyProgress({ ...base }), 0)
  assert.equal(historyProgress({ ...base, historyOldestAt: 200 * DAY }), 0)
  assert.equal(historyProgress({ ...base, historyOldestAt: 155 * DAY }), 25)
  assert.equal(historyProgress({ ...base, historyOldestAt: 5 * DAY }), 100)
})

test('status details explain history, catch-up and pauses in plain language', () => {
  assert.equal(linkStatusDetail('slack', link({ status: 'history', historyTargetAt: 20 * DAY, historyOldestAt: 110 * DAY }), 0), '50% of the last 180 days · new messages already sync')
  assert.equal(linkStatusDetail('slack', link({ status: 'catching_up', catchUpUntil: 150_000 }), 0), 'The Slack rate limit was reached. Resumes automatically in 3 min.')
  assert.equal(linkStatusDetail('teams', link({ status: 'catching_up' }), 0), 'The Microsoft Teams rate limit was reached. Resumes automatically.')
  assert.equal(linkStatusDetail('slack', link({ status: 'paused', pauseReason: 'disconnected' }), 0), 'Reconnect Slack to resume.')
  assert.equal(linkStatusDetail('teams', link({ status: 'paused', pauseReason: 'Add Overlay to this shared channel in Teams to resume.' }), 0), 'Add Overlay to this shared channel in Teams to resume.')
  assert.equal(linkStatusDetail('slack', link({ status: 'syncing' }), 0), null)
})

test('the health note leads with the most urgent state', () => {
  assert.equal(healthNote('slack', []), null)
  assert.deepEqual(healthNote('slack', [link({}), link({ status: 'syncing' })]), { tone: 'ok', text: 'All 2 linked channels are live.' })
  assert.equal(healthNote('slack', [link({}), link({ status: 'history' })])?.text, 'Importing history for 1 channel. New messages already sync.')
  assert.equal(healthNote('slack', [link({ status: 'history' }), link({ status: 'catching_up' })])?.tone, 'busy')
  assert.equal(healthNote('slack', [link({ status: 'catching_up' }), link({ status: 'paused' })])?.tone, 'warning')
})

test('private, shared and Teams channels need private Overlay targets', () => {
  assert.equal(needsPrivateTarget('slack', 'public'), false)
  assert.equal(needsPrivateTarget('slack', 'shared'), true)
  assert.equal(needsPrivateTarget('teams', 'public'), true)
})

test('connect URLs return to the settings page for the right workspace', () => {
  const slack = syncUrls('slack', '/app/settings?section=workspace&workspace_tab=import', 'ws 1')
  assert.equal(slack.connect, '/api/v1/surfaces/slack/connect?purpose=sync&returnTo=%2Fapp%2Fsettings%3Fsection%3Dworkspace%26workspace_tab%3Dimport&workspaceId=ws%201')
  assert.match(slack.connectAccount, /^\/api\/v1\/surfaces\/slack\/connect\?purpose=sync_member&returnTo=/)
  assert.equal(slack.appPackage, null)
  const teams = syncUrls('teams', '/app/settings', 'ws')
  assert.match(teams.connect, /^\/api\/v1\/sync\/teams\/connect\?returnTo=/)
  assert.match(teams.connectAccount, /^\/api\/v1\/sync\/teams\/account\/connect\?returnTo=/)
  assert.equal(teams.appPackage, '/api/v1/sync/teams/app-package?workspaceId=ws')
})

test('OAuth returns become one toast', () => {
  assert.deepEqual(oauthReturnNotice(new URLSearchParams('syncConnected=slack')), { kind: 'success', provider: 'slack', text: 'Slack connected.' })
  assert.deepEqual(oauthReturnNotice(new URLSearchParams('syncConnected=teams_member')), { kind: 'success', provider: 'teams', text: 'Your Microsoft Teams account is connected.' })
  assert.equal(oauthReturnNotice(new URLSearchParams('surfaceError=forbidden'))?.text, 'Only workspace owners and admins can connect the workspace.')
  assert.equal(oauthReturnNotice(new URLSearchParams('surfaceError=weird'))?.text, 'The connection failed. Try again.')
  assert.deepEqual(oauthReturnNotice(new URLSearchParams('syncAccountConnected=slack')), { kind: 'success', provider: 'slack', text: 'Your Slack account is connected.' })
  assert.equal(oauthReturnNotice(new URLSearchParams('syncError=wrong_organization'))?.text, 'Sign in with an account from the connected Microsoft organization.')
  assert.equal(oauthReturnNotice(new URLSearchParams('section=workspace')), null)
})
