import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { InlineNavChildren } from './AppSidebarInlinePanels'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const CHAT_VIEWS = [
  { id: 'personal', label: 'Personal' },
  { id: 'dms', label: 'Direct Messages' },
  { id: 'channels', label: 'Channels' },
  { id: 'unread', label: 'Unread' },
  { id: 'all', label: 'All' },
]

test('an expanded section lists every subview', () => {
  const html = renderToStaticMarkup(
    <InlineNavChildren
      id="sidebar-section-app-chat"
      items={CHAT_VIEWS}
      activeId="personal"
      onSelect={() => undefined}
    />,
  )
  for (const view of CHAT_VIEWS) assert.match(html, new RegExp(view.label))
  // The container is addressable so the section button can own aria-controls.
  assert.match(html, /id="sidebar-section-app-chat"/)
})

test('opening a section from elsewhere selects nothing on the person behalf', () => {
  // A person on Files opens the Chats dropdown: it must read as a menu of
  // choices, not as though Personal were already selected.
  const html = renderToStaticMarkup(
    <InlineNavChildren items={CHAT_VIEWS} activeId="" onSelect={() => undefined} />,
  )
  // Only the selected row carries the surface class unprefixed; every row has a
  // hover: variant of it, so the assertion has to exclude the hover form.
  const selected = /transition-colors bg-\[var\(--surface-subtle\)\]/
  assert.doesNotMatch(html, selected)

  const onRoute = renderToStaticMarkup(
    <InlineNavChildren items={CHAT_VIEWS} activeId="dms" onSelect={() => undefined} />,
  )
  assert.match(onRoute, selected)
  assert.equal(onRoute.match(selected)?.length, 1)
})

test('a locked subview is inert rather than a dead link', () => {
  const html = renderToStaticMarkup(
    <InlineNavChildren
      items={[{ id: 'skills', label: 'Skills', locked: true }]}
      activeId=""
      onSelect={() => undefined}
    />,
  )
  assert.match(html, /Soon/)
  assert.match(html, /cursor-default/)
})

test('items with an href render as links so they support open-in-new-tab', () => {
  const html = renderToStaticMarkup(
    <InlineNavChildren
      items={[
        { id: 'general', label: 'General', href: '/app/settings?section=general' },
        { id: 'models', label: 'Models', href: '/app/settings?section=models' },
      ]}
      activeId="models"
      onSelect={() => undefined}
    />,
  )
  assert.match(html, /href="\/app\/settings\?section=general"/)
  assert.match(html, /href="\/app\/settings\?section=models"/)
  assert.doesNotMatch(html, /<button/)
})

test('the container class can be overridden for flat panel layouts', () => {
  const html = renderToStaticMarkup(
    <InlineNavChildren
      items={[{ id: 'personal', label: 'Personal' }]}
      activeId=""
      onSelect={() => undefined}
      className="shrink-0 space-y-0.5 px-2 py-3"
    />,
  )
  assert.match(html, /shrink-0 space-y-0\.5 px-2 py-3/)
  assert.doesNotMatch(html, /pl-7/)
})
