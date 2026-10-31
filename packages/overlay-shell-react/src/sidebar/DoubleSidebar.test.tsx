import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { Bot, FileText, ListChecks, MessageSquare, Puzzle, Workflow } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DoubleSidebar, selectDoubleSidebarItem, type DoubleSidebarProps } from './DoubleSidebar'
import type { PrimaryRailItem } from '../types'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const noop = () => undefined
const items: PrimaryRailItem[] = [
  { id: 'work', label: 'Work', icon: ListChecks, href: '/app/work', onSelect: noop },
  { id: 'agents', label: 'Agents', icon: Bot, href: '/app/agents', active: true, onSelect: noop },
  { id: 'chat', label: 'Chats', icon: MessageSquare, href: '/app/chat', onSelect: noop },
  { id: 'files', label: 'Files', icon: FileText, href: '/app/files', onSelect: noop },
  { id: 'extensions', label: 'Extensions', icon: Puzzle, href: '/app/tools', onSelect: noop },
  { id: 'automations', label: 'Automations', icon: Workflow, href: '/app/automations', onSelect: noop },
]

function render(props: Partial<DoubleSidebarProps> = {}) {
  return renderToStaticMarkup(<DoubleSidebar brand="Overlay" railBrand="O" title="Agents" panelId="context-panel" collapsed={false} onCollapsedChange={noop} items={items} panelKind="agents" scope="personal" account="Account" onSearch={noop} panelAction={{ label: 'New agent', onClick: noop }} {...props}>Agent list</DoubleSidebar>)
}

test('double sidebar keeps the rail and account outside the collapsible contextual panel', () => {
  const html = render({ collapsed: true })
  const split = html.indexOf('id="context-panel"')
  const rail = html.slice(0, split)
  const panel = html.slice(split)
  assert.match(rail, /aria-label="Primary navigation"/)
  for (const href of ['/app/work', '/app/agents', '/app/chat']) assert.ok(rail.includes(`href="${href}"`))
  assert.match(rail, /Account/)
  assert.match(rail, /aria-label="Expand sidebar"/)
  assert.match(panel, /aria-hidden="true"/)
  assert.match(panel, /inert=""/)
  assert.match(panel, /w-0/)
  assert.match(panel, /Agent list/)
})

test('secondary destinations are behind More; header actions and scope stay in the panel', () => {
  const html = render()
  assert.match(html, /aria-label="More"/)
  for (const href of ['/app/files', '/app/tools', '/app/automations']) assert.ok(!html.includes(`href="${href}"`))
  assert.match(html, /aria-label="Search agents"/)
  assert.match(html, /aria-label="New agent"/)
  assert.match(html, /aria-label="Scope"/)
  assert.match(html, /Personal/)
  assert.match(html, /Workspace/)
  assert.match(html, /272px/)
  assert.doesNotMatch(render({ items: items.slice(0, 3), panelAction: null }), /aria-label="More"|aria-label="New agent"/)
})

test('active destination toggles without selecting or resetting its current thread', () => {
  const selected: string[] = []
  const collapsed: boolean[] = []
  const active = { ...items[1], onSelect: () => selected.push('agents') }
  selectDoubleSidebarItem(active, false, (next) => collapsed.push(next))
  selectDoubleSidebarItem(active, true, (next) => collapsed.push(next))
  assert.deepEqual(selected, [])
  assert.deepEqual(collapsed, [true, false])
  selectDoubleSidebarItem({ ...active, active: false }, true, (next) => collapsed.push(next))
  assert.deepEqual(selected, ['agents'])
  assert.deepEqual(collapsed, [true, false, false])
  selectDoubleSidebarItem({ ...active, disabled: true }, true, (next) => collapsed.push(next))
  assert.deepEqual(selected, ['agents'])
  assert.deepEqual(collapsed, [true, false, false])
})

test('work keeps view navigation plus separately rendered task groups', () => {
  const html = render({
    title: 'Work', panelKind: 'work',
    panelNav: { items: [{ id: 'personal', label: 'Personal', children: [{ id: 'personal:list', label: 'List' }, { id: 'personal:board', label: 'Board' }, { id: 'personal:timeline', label: 'Timeline' }] }], activeId: 'personal', activeChildId: 'personal:list', onSelect: noop },
    sectionRows: [{ id: 'mine', label: 'Mine' }, { id: 'all', label: 'All' }],
    renderSection: (id) => <span>{`tasks-${id}`}</span>,
  })
  for (const label of ['List', 'Board', 'Timeline', 'tasks-mine', 'tasks-all']) assert.match(html, new RegExp(label))
})

test('settings retains its own navigation instead of showing a scope selector', () => {
  const html = render({ title: 'Settings', panelKind: 'settings', panelNav: { items: [{ id: 'general', label: 'General', href: '/app/settings' }], activeId: 'general', onSelect: noop } })
  assert.match(html, /General/)
  assert.doesNotMatch(html, /aria-label="Scope"/)
})
