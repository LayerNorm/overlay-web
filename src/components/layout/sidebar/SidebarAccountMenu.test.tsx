import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SidebarAccountMenu } from './SidebarAccountMenu'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const ENTITLEMENTS = {
  tier: 'pro' as const,
  planKind: 'paid' as const,
  creditsUsed: 0,
  creditsTotal: 20,
  budgetUsedCents: 250,
  budgetTotalCents: 2000,
  dailyUsage: { ask: 0, write: 0, agent: 0 },
  overlayStorageBytesUsed: 108 * 1024 * 1024,
  overlayStorageBytesLimit: 1024 * 1024 * 1024,
}

function render() {
  return renderToStaticMarkup(
    <SidebarAccountMenu
      billingEnabled
      entitlements={ENTITLEMENTS}
      onAccountClick={() => undefined}
      onSignOut={() => undefined}
    />,
  )
}

test('usage, storage, and apps collapse behind disclosure headers', () => {
  const html = render()
  for (const label of ['Usage', 'Storage', 'Apps']) {
    assert.match(html, new RegExp(`aria-expanded="false"[^>]*>.*?${label}`, 's'))
  }
  // Collapsed sections keep their rows out of the menu until opened.
  assert.doesNotMatch(html, /Chrome Extension/)
  assert.doesNotMatch(html, /available/)
})

test('account settings and sign out stay one click away', () => {
  const html = render()
  assert.match(html, /href="\/app\/settings\?section=account"/)
  assert.match(html, /href="\/app\/settings"/)
  assert.match(html, /Account/)
  assert.match(html, /Sign out/)
})
