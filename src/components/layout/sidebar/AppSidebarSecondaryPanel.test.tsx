import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppSidebarSecondaryPanel, SecondaryPanelContent } from './AppSidebarSecondaryPanel'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

test('the panel renders its section title and subnavigation', () => {
  const html = renderToStaticMarkup(
    <AppSidebarSecondaryPanel
      title="Chats"
      nav={{
        items: [
          { id: 'personal', label: 'Personal' },
          { id: 'dms', label: 'Direct Messages' },
        ],
        activeId: 'dms',
        onSelect: () => undefined,
      }}
    >
      <div>conversation list</div>
    </AppSidebarSecondaryPanel>,
  )
  assert.match(html, /Chats/)
  assert.match(html, /Personal/)
  assert.match(html, /Direct Messages/)
  assert.match(html, /conversation list/)
})

test('the panel renders the resource action and search affordance', () => {
  const html = renderToStaticMarkup(
    <AppSidebarSecondaryPanel
      title="Files"
      action={{ label: 'New Note', onClick: () => undefined }}
      search={{ title: 'Search files (⌘K)', onClick: () => undefined }}
    >
      <div>file list</div>
    </AppSidebarSecondaryPanel>,
  )
  assert.match(html, /New Note/)
  assert.match(html, /title="Search files \(⌘K\)"/)
  assert.match(html, /file list/)
})

test('panel content works standalone for the mobile drawer panel step', () => {
  const html = renderToStaticMarkup(
    <SecondaryPanelContent
      nav={{
        items: [{ id: 'general', label: 'General', href: '/app/settings?section=general' }],
        activeId: 'general',
        onSelect: () => undefined,
      }}
      footer={<div>footer links</div>}
    />,
  )
  assert.match(html, /href="\/app\/settings\?section=general"/)
  assert.match(html, /footer links/)
})
