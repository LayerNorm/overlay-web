import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { Bell, FileText, Hash, ListChecks, Mail, MessageSquare, Puzzle } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { UnifiedSidebar, type UnifiedSidebarProps } from './UnifiedSidebar'
import { publishPageSubviews } from './pageSubviewStore'
import type { SecondaryPanelNav } from './AppSidebarSecondaryPanel'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const noop = () => undefined
const items: UnifiedSidebarProps['items'] = [
  { id: 'work', label: 'Work', icon: ListChecks, href: '/app/work', onSelect: noop },
  { id: 'chat', label: 'Chats', icon: MessageSquare, href: '/app/chat', active: true, badgeCount: 3, onSelect: noop },
  { id: 'files', label: 'Files', icon: FileText, href: '/app/files', onSelect: noop },
  { id: 'extensions', label: 'Extensions', icon: Puzzle, href: '/app/tools', onSelect: noop },
]

const chatNav: SecondaryPanelNav = {
  items: [
    { id: 'personal', label: 'Personal', icon: MessageSquare },
    {
      id: 'workspace',
      label: 'Workspace',
      icon: Hash,
      children: [
        { id: 'workspace:dms', label: 'Direct messages', icon: Mail, badgeCount: 2 },
        { id: 'workspace:channels', label: 'Channels', icon: Hash },
        { id: 'workspace:activity', label: 'Activity', icon: Bell },
      ],
    },
  ],
  activeId: 'workspace',
  activeChildId: 'workspace:dms',
  onSelect: noop,
}

function render(overrides: Partial<UnifiedSidebarProps> = {}) {
  return renderToStaticMarkup(
    <UnifiedSidebar
      brand={<span>overlay</span>}
      collapsed={false}
      onCollapsedChange={noop}
      items={items}
      panelKind="chat"
      panelNav={chatNav}
      onSearch={noop}
      scope="workspace"
      solo={false}
      account={<span>Account</span>}
      {...overrides}
    />,
  )
}

test('main pages render as links and Files and Extensions move under Explore', () => {
  const html = render()
  assert.match(html, /href="\/app\/work"/)
  assert.match(html, /href="\/app\/chat"/)
  assert.doesNotMatch(html, /href="\/app\/files"/)
  assert.doesNotMatch(html, /href="\/app\/tools"/)
  assert.match(html, /aria-label="Explore"/)
  assert.match(html, />3</)
})

test('the scope toggle marks the selected scope and hides for a solo workspace', () => {
  const html = render()
  assert.match(html, /aria-pressed="true"[^>]*>Workspace</)
  assert.match(html, /aria-pressed="false"[^>]*>Personal</)
  assert.doesNotMatch(render({ solo: true }), /aria-label="Scope"/)
})

test('chat destinations for the selected scope render as sidebar rows', () => {
  const html = render()
  assert.match(html, /Direct messages/)
  assert.match(html, /Channels/)
  assert.match(html, /Activity/)
  assert.match(html, /data-active="true"(?:(?!data-active).)*<span>Direct messages/s)
})

test('collapsed shows icons only, with labels as titles', () => {
  const html = render({ collapsed: true })
  assert.doesNotMatch(html, /<span>Work<\/span>/)
  assert.match(html, /title="Work"/)
  assert.doesNotMatch(html, /aria-label="Scope"/)
  assert.doesNotMatch(html, /Direct messages/)
})

test('tab pages keep their subviews out of the sidebar', () => {
  const workNav: SecondaryPanelNav = {
    items: [
      { id: 'personal', label: 'Personal', icon: ListChecks, children: [
        { id: 'personal:list', label: 'List' },
        { id: 'personal:board', label: 'Board' },
      ] },
      { id: 'workspace', label: 'Workspace', icon: ListChecks },
    ],
    activeId: 'personal',
    activeChildId: 'personal:list',
    onSelect: noop,
  }
  const html = render({ panelKind: 'work', panelNav: workNav, scope: 'personal' })
  assert.doesNotMatch(html, /Board/)
  publishPageSubviews(null)
})
