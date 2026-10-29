import assert from 'node:assert/strict'
import test from 'node:test'
import React, { type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button, Tabs } from '@overlay/ui/primitives'
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
  let closed = false
  const sidebarProps = {
    ariaLabel: 'Agent details',
    hero: {
      avatar: <span>Avatar</span>,
      title: <Button variant="ghost" type="button">Maya</Button>,
      titleText: 'Maya',
      subtitle: <Button variant="ghost" type="button">Research assistant</Button>,
    },
    tabs: [
      { id: 'details', label: 'Details', content: <span>Agent settings</span> },
      { id: 'library', label: 'Library', content: <span>Conversation files</span> },
    ],
    activeTab: 'details',
    onTabChange: (id: string) => changes.push(id),
    onClose: () => { closed = true },
  }
  const sidebar = RightSidebar(sidebarProps)
  const markup = renderToStaticMarkup(sidebar)
  assert.match(markup, /aria-label="Agent details"/)
  assert.match(markup, /Maya/)
  assert.match(markup, /Research assistant/)
  assert.match(markup, /aria-label="Maya"/)
  assert.match(markup, /<button[^>]*>Maya<\/button>/)
  assert.match(markup, /Details/)
  assert.match(markup, /Library/)
  assert.match(markup, /Agent settings/)
  assert.match(markup, /aria-label="Close"/)
  const closeButton = React.Children.toArray((sidebar.props as { children: ReactNode }).children)
    .find((node) => React.isValidElement(node) && (node.props as { 'aria-label'?: string })['aria-label'] === 'Close')
  assert.ok(React.isValidElement(closeButton))
  ;(closeButton.props as { onClick(): void }).onClick()
  assert.equal(closed, true)
  assert.doesNotMatch(markup, /Conversation files/)

  const tabsRoot = findTabsRoot(sidebar)
  assert.ok(tabsRoot)
  ;(tabsRoot.props as { onValueChange(value: string): void }).onValueChange('library')
  assert.deepEqual(changes, ['library'])
})

test('right sidebar only mounts the active tab panel', () => {
  const markup = renderToStaticMarkup(
    <RightSidebar
      ariaLabel="Agent details"
      hero={{ avatar: <span>Avatar</span>, title: 'Maya', titleText: 'Maya' }}
      tabs={[
        { id: 'details', label: 'Details', content: <span>Agent settings</span> },
        { id: 'library', label: 'Library', content: <span>Conversation files</span> },
      ]}
      activeTab="library"
      onTabChange={() => {}}
    />,
  )

  assert.match(markup, /Conversation files/)
  assert.doesNotMatch(markup, /Agent settings/)
})
