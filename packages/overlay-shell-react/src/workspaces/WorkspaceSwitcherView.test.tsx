import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { getFooterWorkspaceMenuSide, subscribeToWorkspaceMenuViewport, WorkspaceSwitcherView } from './WorkspaceSwitcherView'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const noop = () => undefined

test('footer account menu opens above mobile drawers and tracks the desktop breakpoint', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let listener: (() => void) | undefined
  let notifications = 0
  const viewport = {
    matches: false,
    addEventListener(event: string, callback: () => void) {
      assert.equal(event, 'change')
      listener = callback
    },
    removeEventListener(event: string, callback: () => void) {
      assert.equal(event, 'change')
      assert.equal(callback, listener)
      listener = undefined
    },
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { matchMedia(query: string) { assert.equal(query, '(min-width: 768px)'); return viewport } },
  })
  try {
    const unsubscribe = subscribeToWorkspaceMenuViewport(() => { notifications += 1 })
    assert.equal(getFooterWorkspaceMenuSide(), 'top')
    viewport.matches = true
    listener?.()
    assert.equal(getFooterWorkspaceMenuSide(), 'right')
    viewport.matches = false
    listener?.()
    assert.equal(getFooterWorkspaceMenuSide(), 'top')
    assert.equal(notifications, 2)
    unsubscribe()
    assert.equal(listener, undefined)
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

function render(status: 'idle' | 'loading' | 'ready', userAvatar?: ReactNode) {
  return renderToStaticMarkup(
    <WorkspaceSwitcherView
      rootRef={{ current: null }}
      menuRef={{ current: null }}
      open={false}
      compact={false}
      placement="footer"
      userAvatar={userAvatar}
      accountMenu={<div>Account items</div>}
      userLabel="Dev Doe"
      renderAvatar={() => <span>Workspace avatar</span>}
      status={status}
      workspaces={[]}
      activeWorkspace={null}
      activeWorkspaceId={null}
      switchingWorkspaceId={null}
      error={null}
      actionError={null}
      refresh={noop}
      onSelectWorkspace={noop}
      onCreateRequest={noop}
      onOpenChange={noop}
    />,
  )
}

test('footer account control stays visible while workspaces are still idle', () => {
  const html = render('idle')
  assert.match(html, /Workspace and account menu/)
  assert.match(html, /Dev Doe/)
})

test('footer account trigger uses the supplied user avatar before workspaces load', () => {
  const html = render('idle', <span data-user-avatar>Profile avatar</span>)
  assert.match(html, /data-user-avatar/)
  assert.match(html, /Profile avatar/)
  assert.doesNotMatch(html, /Workspace avatar/)
})
