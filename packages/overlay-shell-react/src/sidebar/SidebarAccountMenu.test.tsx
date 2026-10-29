import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CollapsibleSection } from '@overlay/ui/primitives'
import { SidebarAccountMenu } from './SidebarAccountMenu'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

function render() {
  return renderToStaticMarkup(
    <SidebarAccountMenu
      usageMeters={
        <>
          <CollapsibleSection label="Usage">
            <div className="px-3 pb-1">Usage details</div>
          </CollapsibleSection>
          <CollapsibleSection label="Storage" className="border-t border-(--border)">
            <div className="px-3 pb-1">Storage details</div>
          </CollapsibleSection>
        </>
      }
      onAccountClick={() => undefined}
      onSignOut={() => undefined}
    />,
  )
}

test('usage and storage collapse behind disclosure headers', () => {
  const html = render()
  for (const label of ['Usage', 'Storage']) {
    assert.match(html, new RegExp(`aria-expanded="false"[^>]*>.*?${label}`, 's'))
  }
  assert.doesNotMatch(html, /Apps/)
  // Collapsed sections keep their rows out of the menu until opened.
  assert.doesNotMatch(html, /Chrome Extension/)
  assert.doesNotMatch(html, />Apps</)
  assert.doesNotMatch(html, /available/)
})

test('account, settings, and sign out stay one click away', () => {
  const html = render()
  assert.match(html, /href="\/account"/)
  assert.match(html, /href="\/app\/settings"/)
  assert.doesNotMatch(html, /href="\/app\/settings\?section=account"/)
  assert.match(html, />Account</)
  assert.match(html, />Settings</)
  assert.match(html, /Sign out/)
})
