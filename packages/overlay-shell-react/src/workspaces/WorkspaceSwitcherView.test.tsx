import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkspaceSwitcherView } from './WorkspaceSwitcherView'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const noop = () => undefined

function render(status: 'idle' | 'loading' | 'ready') {
  return renderToStaticMarkup(
    <WorkspaceSwitcherView
      rootRef={{ current: null }}
      menuRef={{ current: null }}
      open={false}
      compact={false}
      placement="footer"
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
