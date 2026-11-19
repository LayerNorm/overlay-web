import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SyncConnectComposer, syncConnectNotice } from './DirectMessageExperience.parts'

test('a linked Slack channel asks the viewer to connect Slack before replying', () => {
  const html = renderToStaticMarkup(<SyncConnectComposer provider="slack" workspaceId="ws" />)
  assert.match(html, /This channel syncs with Slack\. Replies post there as you\./)
  assert.match(html, /<button[^>]*>Connect Slack to reply<\/button>/)
  assert.doesNotMatch(html, /<textarea/)
})

test('Teams links explain the requirement without a Slack sign-in button', () => {
  const html = renderToStaticMarkup(<SyncConnectComposer provider="teams" workspaceId="ws" />)
  assert.match(html, /syncs with Microsoft Teams/)
  assert.doesNotMatch(html, /<button/)
  assert.equal(syncConnectNotice('teams'), 'Connect Microsoft Teams to reply')
})
