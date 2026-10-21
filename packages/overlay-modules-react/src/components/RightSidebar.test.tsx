import assert from 'node:assert/strict'
import test from 'node:test'
import React, { type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Tabs } from '@overlay/ui/primitives'
import { RightSidebar } from './RightSidebar'

function findTabsRoot(node: ReactNode): ReactElement | undefined {
  if (!React.isValidElement(node)) return undefined
  if (node.type === Tabs) return node
  return React.Children.toArray((node.props as { children?: ReactNode }).children)
    .map(findTabsRoot)
    .find((child) => child !== undefined)
}

test('right sidebar renders its hero and tabs and forwards tab changes', () => {
  const changes: string[] = []
  const sidebarProps = {
    ariaLabel: 'Agent details',
    hero: { avatar: <span>Avatar</span>, title: 'Maya', subtitle: 'Research assistant' },
    tabs: [
      { id: 'details', label: 'Details', content: <span>Agent settings</span> },
      { id: 'library', label: 'Library', content: <span>Conversation files</span> },
    ],
    activeTab: 'details',
    onTabChange: (id) => changes.push(id),
  }
  const sidebar = RightSidebar(sidebarProps)
  const markup = renderToStaticMarkup(sidebar)
  assert.match(markup, /aria-label="Agent details"/)
  assert.match(markup, /Maya/)
  assert.match(markup, /Research assistant/)
  assert.match(markup, /Details/)
  assert.match(markup, /Library/)
  assert.match(markup, /Agent settings/)
  assert.match(markup, /Conversation files/)

  const tabsRoot = findTabsRoot(sidebar)
  assert.ok(tabsRoot)
  ;(tabsRoot.props as { onValueChange(value: string): void }).onValueChange('library')
  assert.deepEqual(changes, ['library'])
})
