import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { MessageSquare } from 'lucide-react'
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
