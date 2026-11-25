import assert from 'node:assert/strict'
import test from 'node:test'
import type { CaptureResult } from 'posthog-js'
import { withoutPageContext } from './posthog-client'

const conversationId = 'jd7f3k2m9q8x1v4b6n5c0z2a7s3d'
const chatUrl = `https://www.overlay.works/app/w/team/chat?id=${conversationId}&token=secret`

function captured(event: string): CaptureResult {
  return {
    uuid: 'event-uuid',
    event,
    properties: {
      ttft_ms: 812, model_id: 'model-a', is_new_chat: false, was_hidden: false, transport: 'convex',
      token: 'phc_project', distinct_id: 'user-1', $session_id: 'session-1', $lib: 'web', $browser: 'Chrome',
      deployment: 'web', environment: 'production', release: 'abc123', route: '/app/w/team/chat',
      $current_url: chatUrl, $host: 'www.overlay.works', $pathname: '/app/w/team/chat',
      $referrer: chatUrl, $referring_domain: 'www.overlay.works',
      $session_entry_url: chatUrl, $session_entry_pathname: '/app/w/team/chat', $session_entry_referrer: chatUrl,
      $session_entry_utm_source: 'newsletter', utm_campaign: 'launch',
      $set: { $current_url: chatUrl, nested: { url: chatUrl } },
      $set_once: { $initial_current_url: chatUrl, $initial_pathname: '/app/w/team/chat' },
      $unset: ['$current_url'],
    },
    $set: { $current_url: chatUrl },
    $set_once: { $initial_current_url: chatUrl, $initial_referrer: chatUrl },
    $unset: ['$initial_current_url'],
  }
}

test('the first-reply event leaves with no URL, referrer, entry page or person update', () => {
  const result = withoutPageContext(captured('chat_first_text_visible'))!
  assert.deepEqual(Object.keys(result.properties).sort(), [
    '$browser', '$lib', '$session_id', 'deployment', 'distinct_id', 'environment', 'is_new_chat',
    'model_id', 'release', 'token', 'transport', 'ttft_ms', 'was_hidden',
  ])
  assert.deepEqual(Object.keys(result).sort(), ['event', 'properties', 'timestamp', 'uuid'])
  const sent = JSON.stringify(result)
  assert.equal(sent.includes(conversationId), false)
  assert.equal(sent.includes('?'), false)
  assert.equal(sent.includes('secret'), false)
  assert.equal(sent.includes('overlay.works'), false)
})

test('other events are left as they were', () => {
  const pageview = captured('$pageview')
  assert.equal(withoutPageContext(pageview), pageview)
  assert.equal(withoutPageContext(null), null)
})
