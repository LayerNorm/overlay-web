import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorkspaceAgentBundle, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { AgentThreadRows } from './AppSidebarAgentThreads'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const agent = { id: 'agent_1', name: 'Overlay' } as WorkspaceAgentDirectoryItem
const noop = () => undefined

function render(bundle: WorkspaceAgentBundle | 'loading' | 'error', props: { activeConversationId?: string | null } = {}) {
  return renderToStaticMarkup(
    <AgentThreadRows
      agent={agent}
      bundle={bundle}
      activeConversationId={props.activeConversationId ?? null}
      onOpenThread={noop}
      onOpenAutomation={noop}
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

test('agent threads expose a scoped tree hook without redundant labels or creation rows', () => {
  const html = render(bundle)
  assert.match(html, /data-slot="sidebar-menu"/)
  assert.match(html, /agent-thread-tree/)
  assert.doesNotMatch(html, /data-slot="sidebar-menu-sub"/)
  assert.doesNotMatch(html, /border-l|ml-3\.5|pl-2/)
  assert.match(html, /\[&amp;&gt;svg\]:mx-1/)
  for (const label of ['Overlay', 'Q4 launch plan', 'Daily digest', 'PR sweep']) assert.match(html, new RegExp(label))
  // Archived threads belong to Settings → Archived.
  assert.doesNotMatch(html, /Old thread/)
  assert.doesNotMatch(html, />Main<|New thread/)
  assert.match(html, /Paused/)
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

test('an automation without a conversation remains openable', () => {
  const html = render(bundle)
  assert.doesNotMatch(html, /disabled=""[^>]*>[\s\S]*?PR sweep/)
})

test('threads that are loading show placeholders; a failed load says so', () => {
  const loading = render('loading')
  assert.equal(loading.match(/data-slot="sidebar-menu-skeleton"/g)?.length, 3)
  assert.match(loading, /aria-label="Loading Overlay threads"/)
  assert.match(render('error'), /Could not load threads/)
})
