import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { Hash, Mail, MessageSquare } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppSidebarPrimaryRail } from './AppSidebarPrimaryRail'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

test('primary navigation destinations render as links for modifier-click', () => {
  const html = renderToStaticMarkup(
    <AppSidebarPrimaryRail
      brand={<span>Overlay</span>}
      items={[{
        id: 'chat',
        label: 'Chats',
        icon: MessageSquare,
        href: '/app/chat',
        onSelect: () => undefined,
      }]}
      account={<span>Account</span>}
    />,
  )
  assert.match(html, /href="\/app\/chat"/)
  assert.doesNotMatch(html, /<button[^>]*aria-label="Chats"/)
})

const SECTION_NAV = {
  items: [
    { id: 'personal', label: 'Personal', icon: MessageSquare },
    { id: 'dms', label: 'Direct Messages', icon: Mail },
    { id: 'channels', label: 'Channels', icon: Hash },
    { id: 'unrenderable', label: 'No icon' },
  ],
  activeId: 'personal',
  onSelect: () => undefined,
}

const RAIL_ITEMS = [{
  id: 'chat',
  label: 'Chats',
  icon: MessageSquare,
  href: '/app/chat',
  onSelect: () => undefined,
}]

test('collapsing the rail keeps the active section reachable as icons', () => {
  const html = renderToStaticMarkup(
    <AppSidebarPrimaryRail
      brand={<span>Overlay</span>}
      items={RAIL_ITEMS}
      sectionNav={SECTION_NAV}
      account={<span>Account</span>}
    />,
  )
  assert.match(html, /aria-label="Direct Messages"/)
  assert.match(html, /aria-label="Channels"/)
  // A subview with no icon has no icon-only form to render.
  assert.doesNotMatch(html, /aria-label="No icon"/)
})

test('the expanded rail leaves the section to the secondary panel', () => {
  const html = renderToStaticMarkup(
    <AppSidebarPrimaryRail
      brand={<span>Overlay</span>}
      items={RAIL_ITEMS}
      sectionNav={SECTION_NAV}
      account={<span>Account</span>}
      expanded
    />,
  )
  assert.doesNotMatch(html, /aria-label="Direct Messages"/)
})
