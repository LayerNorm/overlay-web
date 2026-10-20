import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AutomationSummary, FileTreeEntry } from '@overlay/app-core'
import { SidebarMenuSubButton } from '@overlay/ui/primitives'
import { FilesInlineTree } from './file-tree'
import { AutomationsInlineList, type AutomationsInlineListProps } from './automations/inline-list'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const noop = () => undefined

function assertChatRowStyle(html: string, count: number) {
  const reference = renderToStaticMarkup(<SidebarMenuSubButton>Chat</SidebarMenuSubButton>)
  const classes = reference.match(/class="([^"]+)"/)![1]!.split(' ')
  const rows = [...html.matchAll(/data-slot="sidebar-menu-sub-button"[^>]*class="([^"]+)"/g)]
  assert.equal(rows.length, count)
  for (const row of rows) {
    const actual = new Set(row[1]!.split(' '))
    for (const className of classes) assert.ok(actual.has(className), `Missing chat row style: ${className}`)
  }
}

test('files and nested notes use chat rows while retaining folder controls and file icons', () => {
  const files = [
    { _id: 'folder', name: 'Project', type: 'folder' },
    { _id: 'note', name: 'Plan', type: 'file', kind: 'note', parentId: 'folder' },
    { _id: 'pdf', name: 'Report.pdf', type: 'file' },
  ] as FileTreeEntry[]
  const html = renderToStaticMarkup(
    <FilesInlineTree files={files} expanded={new Set(['folder'])} activeFileId="note" onToggle={noop} onOpen={noop} onMove={noop} />,
  )
  assertChatRowStyle(html, 3)
  assert.equal(html.match(/aria-current="page"/g)?.length, 1)
  assert.match(html, /aria-label="Collapse folder" aria-expanded="true"/)
  assert.match(html, /data-slot="sidebar-menu-sub"/)
  assert.match(html, /draggable="true"/)
  assert.match(html, /width="16" height="16"/)
  assert.match(html, /lucide-book-open/)
})

const automation = {
  _id: 'automation', name: 'Daily digest', enabled: true, conversationId: 'conversation',
} as AutomationSummary

function renderAutomation(overrides: Partial<AutomationsInlineListProps> = {}) {
  return renderToStaticMarkup(
    <AutomationsInlineList
      automations={[automation]}
      editingAutomationName="Daily digest"
      onNavigateAutomation={noop}
      onBeginRename={noop}
      onEditingNameChange={noop}
      onCommitRename={noop}
      onCancelRename={noop}
      onRequestDelete={noop}
      onConfirmDelete={noop}
      onClearPendingDelete={noop}
      {...overrides}
    />,
  )
}

test('automation rows match chats and preserve active, pending and action states', () => {
  const html = renderAutomation({ activeAutomationId: automation._id })
  assertChatRowStyle(html, 1)
  assert.match(html, /data-active="true"/)
  assert.match(html, /aria-current="page"/)
  assert.match(html, /aria-label="Rename automation"/)
  assert.match(html, /aria-label="Delete automation"/)
  assert.match(html, /group-focus-within\/automation-row:opacity-100/)
  const pending = renderAutomation({ pendingNavId: automation._id })
  assert.match(pending, /disabled=""/)
  assert.match(pending, /lucide-loader-circle/)
  assert.match(renderAutomation({ pendingDeleteAutomationId: automation._id }), /aria-label="Confirm delete automation"/)
})

test('renaming keeps automation row height and typography', () => {
  const html = renderAutomation({ editingAutomationId: automation._id })
  assert.match(html, /h-8[^\"]*text-sm/)
  assert.match(html, /aria-label="Automation name"/)
  assert.doesNotMatch(html, /aria-label="Rename automation"/)
})
