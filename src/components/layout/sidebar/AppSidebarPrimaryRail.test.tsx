import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { Hash, Mail, MessageSquare, X } from 'lucide-react'
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

test('primary rail uses shadcn Sidebar structure in expanded and collapsed states', () => {
  for (const expanded of [true, false]) {
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
        expanded={expanded}
      />,
    )
    const state = expanded ? 'expanded' : 'collapsed'
    assert.match(html, new RegExp(`<aside data-slot="sidebar" data-state="${state}"`))
    assert.match(html, /data-slot="sidebar-header"/)
    assert.match(html, /data-slot="sidebar-footer"/)
    assert.match(html, /<li data-slot="sidebar-menu-item"/)
  }
})

test('active expanded button uses SidebarMenuButton sizing and active state', () => {
  const html = renderToStaticMarkup(
    <AppSidebarPrimaryRail
      brand={<span>Overlay</span>}
      items={[{
        id: 'settings-close',
        label: 'Settings',
        icon: X,
        active: true,
        onSelect: () => undefined,
      }]}
      account={<span>Account</span>}
      expanded
    />,
  )
  const button = html.match(/<button\b(?=[^>]*data-sidebar="menu-button")(?=[^>]*aria-label="Settings")[^>]*>/)?.[0]
  assert.ok(button)
  assert.match(button, /data-active="true"/)
  assert.match(button, /aria-current="page"/)
  const className = button.match(/\bclass="([^"]*)"/)?.[1]
  assert.ok(className)
  const classes = new Set(className.split(/\s+/))

  for (const expected of ['h-9', 'gap-2.5', 'px-3', 'relative']) {
    assert.equal(classes.has(expected), true, `${expected} should be present`)
  }
  for (const obsolete of ['inline-block', 'h-auto', 'rounded-none']) {
    assert.equal(classes.has(obsolete), false, `${obsolete} should be absent`)
  }
})

test('collapsed button navigation entries are centered without horizontal padding', () => {
  const html = renderToStaticMarkup(
    <AppSidebarPrimaryRail
      brand={<span>Overlay</span>}
      items={[{
        id: 'settings-close',
        label: 'Settings',
        icon: X,
        onSelect: () => undefined,
      }]}
      account={<span>Account</span>}
    />,
  )
  const button = html.match(/<button\b(?=[^>]*aria-label="Settings")[^>]*>/)?.[0]
  assert.ok(button)
  const className = button.match(/\bclass="([^"]*)"/)?.[1]
  assert.ok(className)
  const classes = new Set(className.split(/\s+/))
  assert.equal(classes.has('justify-center'), true)
  assert.equal(classes.has('px-0'), true)
})

test('disabled navigation entries keep their disabled label and state', () => {
  const html = renderToStaticMarkup(
    <AppSidebarPrimaryRail
      brand={<span>Overlay</span>}
      items={[{
        id: 'files',
        label: 'Files',
        icon: MessageSquare,
        active: true,
        disabled: true,
        onSelect: () => undefined,
      }]}
      account={<span>Account</span>}
      expanded
    />,
  )
  const button = html.match(/<button\b(?=[^>]*aria-label="Files \(coming soon\)")[^>]*>/)?.[0]
  assert.ok(button)
  assert.match(button, /\sdisabled(?:=|[\s>])/)
  assert.match(button, /data-active="false"/)
  assert.match(button, /aria-label="Files \(coming soon\)"/)
  const className = button.match(/\bclass="([^"]*)"/)?.[1]
  assert.ok(className)
  const classes = new Set(className.split(/\s+/))
  assert.equal(classes.has('disabled:opacity-100'), true)
  assert.equal(classes.has('cursor-not-allowed'), true)
})

test('empty footer items do not render a menu in the footer', () => {
  const html = renderToStaticMarkup(
    <AppSidebarPrimaryRail
      brand={<span>Overlay</span>}
      items={[]}
      footerItems={[]}
      account={<span>Account</span>}
    />,
  )
  const footer = html.match(/<div data-slot="sidebar-footer"[^>]*>([\s\S]*?)<\/div>/)?.[1]
  assert.ok(footer)
  assert.doesNotMatch(footer, /<ul\b/)
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
