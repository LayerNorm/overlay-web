import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { Circle } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MobileNavStep } from './AppSidebarChrome'

test('mobile navigation exposes the actual rows as tour targets', () => {
  const ids = ['work', 'agents', 'chat', 'automations', 'files', 'extensions']
  const html = renderToStaticMarkup(<MobileNavStep
    brandLink={<span>Overlay</span>}
    onClose={() => {}}
    navItems={ids.map((id) => ({
      id, label: id, icon: Circle, active: false, pending: false,
      unreadCount: 0, opensPanel: false, onSelect() {},
    }))}


    footer={null}
  />)
  for (const id of ids) assert.match(html, new RegExp(`data-tour="nav-${id}"`))
})
