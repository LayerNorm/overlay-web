import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorkspaceAgentBundle, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { AgentThreadRows } from './AppSidebarAgentThreads'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const agent = { id: 'agent_1', name: 'Overlay' } as WorkspaceAgentDirectoryItem
const noop = () => undefined

function render(bundle: WorkspaceAgentBundle | 'loading' | 'error', props: { activeConversationId?: string | null; creatingThread?: boolean } = {}) {
  return renderToStaticMarkup(
    <AgentThreadRows
      agent={agent}
      bundle={bundle}
      activeConversationId={props.activeConversationId ?? null}
      creatingThread={props.creatingThread ?? false}
      onOpenThread={noop}
      onCreateThread={noop}
      onArchiveThread={noop}
      onDeleteThread={noop}
    />,
  )
}

const bundle = {
  threads: [
    { conversationId: 'c_main', title: 'Overlay', isMain: true },
    { conversationId: 'c_plan', title: 'Q4 launch plan' },
    { conversationId: 'c_old', title: 'Old thread', archivedAt: 5 },
  ],
  automations: [
    { automationId: 'a_1', name: 'Daily digest', enabled: true, conversationId: 'c_auto' },
    { automationId: 'a_2', name: 'PR sweep', enabled: false, conversationId: null },
  ],
} as unknown as WorkspaceAgentBundle

test('an agent\'s threads share the icon column without indentation, ending in New thread', () => {
  const html = render(bundle)
  assert.match(html, /data-slot="sidebar-menu"/)
  assert.doesNotMatch(html, /data-slot="sidebar-menu-sub"/)
  assert.doesNotMatch(html, /border-l|ml-3\.5|pl-2/)
  assert.match(html, /\[&amp;&gt;svg\]:mx-1/)
  for (const label of ['Overlay', 'Q4 launch plan', 'Daily digest', 'PR sweep', 'New thread']) assert.match(html, new RegExp(label))
  // Archived threads belong to Settings → Archived.
  assert.doesNotMatch(html, /Old thread/)
  assert.match(html, /Main/)
  assert.match(html, /Paused/)
  // New thread is last in the list.
  assert.ok(html.lastIndexOf('New thread') > html.lastIndexOf('PR sweep'))
})

test('only the open thread is marked current, and each thread has archive and delete actions', () => {
  const html = render(bundle, { activeConversationId: 'c_plan' })
  assert.equal(html.match(/aria-current="page"/g)?.length, 1)
  assert.equal(html.match(/data-active="true"/g)?.length, 1)
  assert.equal(html.match(/aria-label="Archive thread"/g)?.length, 2)
  assert.equal(html.match(/aria-label="Delete thread"/g)?.length, 2)
  // Revealed by hovering or focusing the thread's own row, never the whole agent.
  assert.doesNotMatch(html, /group-hover\/menu-item:opacity-100/)
  assert.match(html, /group-hover\/menu-sub-item:opacity-100/)
})

test('an automation without a conversation is inert; New thread shows a spinner while creating', () => {
  const html = render(bundle)
  assert.match(html, /disabled=""[^>]*>[\s\S]*?PR sweep/)
  const creating = render(bundle, { creatingThread: true })
  assert.match(creating, /animate-spin/)
  assert.match(creating, /disabled=""[^>]*>[\s\S]*?New thread/)
})

test('threads that are loading show placeholders; a failed load says so', () => {
  const loading = render('loading')
  assert.equal(loading.match(/data-slot="sidebar-menu-skeleton"/g)?.length, 3)
  assert.match(loading, /aria-label="Loading Overlay threads"/)
  assert.match(render('error'), /Could not load threads/)
})
