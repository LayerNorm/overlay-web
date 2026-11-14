import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  openTeamsClientState,
  parseTeamsMessageResource,
  teamsClientState,
  teamsResourceKey,
  verifiedTeamsNotifications,
} from './notifications'

process.env.INTERNAL_API_SECRET = 'teams-notification-test-secret'

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8')) as Record<string, unknown>

test('clientState names its link and rejects tampering', () => {
  const state = teamsClientState('link123')
  assert.equal(openTeamsClientState(state), 'link123')
  assert.equal(openTeamsClientState(state.replace('link123', 'link124')), null)
  assert.equal(openTeamsClientState('link123.forged'), null)
  assert.equal(openTeamsClientState(undefined), null)
})

test('a recorded notification without resource data parses to its channel message', () => {
  const notification = fixture('notification-without-resource-data.json')
  const resource = parseTeamsMessageResource(notification.resource as string)
  assert.deepEqual(resource, {
    teamId: 'fbe2bf47-16c8-47cf-b4a5-4b9b187c508b',
    channelId: '19:4a95f7d8db4c4e7fae857bcebe0623e6@thread.tacv2',
    messageId: '1612293113399',
  })
  assert.equal(teamsResourceKey(resource!), '1612293113399')
  const reply = parseTeamsMessageResource("teams('t')/channels('c')/messages('100')/replies('200')")
  assert.equal(teamsResourceKey(reply!), '100/200')
  assert.equal(parseTeamsMessageResource("chats('x')/messages('1')"), null)
})

test('only items carrying our signed clientState are kept, lifecycle included', () => {
  const change = { ...fixture('notification-without-resource-data.json'), clientState: teamsClientState('linkA') }
  const lifecycle = fixture('lifecycle-notification.json') as { value: Array<Record<string, unknown>> }
  const removed = { ...lifecycle.value[0], lifecycleEvent: 'subscriptionRemoved', clientState: teamsClientState('linkB') }
  const forged = { ...change, clientState: 'linkC.bad' }
  const items = verifiedTeamsNotifications(JSON.stringify({ value: [change, removed, forged] }))
  assert.deepEqual(items.map(item => [item.linkId, item.lifecycleEvent ?? item.changeType]), [['linkA', 'created'], ['linkB', 'subscriptionRemoved']])
  assert.deepEqual(verifiedTeamsNotifications('{"type":"conversationUpdate"}'), [])
  assert.deepEqual(verifiedTeamsNotifications('not json'), [])
})
