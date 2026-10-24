import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { AgentDirectoryScreen } from './AgentConversationWorkspace.parts'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

function renderDirectory(scope: 'personal' | 'workspace', directory: WorkspaceAgentDirectoryItem[] | null) {
  return renderToStaticMarkup(
    <AgentDirectoryScreen
      settingsButton={null}
      sideEditor={null}
      onRightPanelClose={() => {}}
      activeWorkspaceId="workspace-1"
      directory={directory}
      viewerPrincipalId="viewer"
      scope={scope}
      resolving={false}
      error={null}
      loadError={null}
      onRetry={() => {}}
      onCreate={() => {}}
    />,
  )
}

test('empty creator scope shows the create state despite agents in the opposite scope', () => {
  const mine = { id: 'mine', createdByPrincipalId: 'viewer' } as WorkspaceAgentDirectoryItem
  const theirs = { id: 'theirs', createdByPrincipalId: 'other' } as WorkspaceAgentDirectoryItem
  for (const [scope, directory] of [['workspace', [mine]], ['personal', [theirs]]] as const) {
    const html = renderDirectory(scope, [...directory])
    assert.match(html, /Your agents work from here/)
    assert.match(html, /Create agent/)
    assert.doesNotMatch(html, /Opening your agent/)
  }
  assert.match(renderDirectory('personal', [mine]), /Opening your agent/)
  assert.match(renderDirectory('workspace', null), /Opening your agent/)
})
