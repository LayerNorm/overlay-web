import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Computer } from '@overlay/workspace-contracts'
import { AgentComputerTabView } from './AgentComputerTab.parts'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const computer: Computer = {
  id: 'computer-1',
  workspaceId: 'workspace-1',
  ownerType: 'agent',
  ownerId: 'agent-1',
  provider: 'box',
  providerRef: 'machine-1',
  size: 'default',
  status: 'ready',
  name: 'Research computer',
  createdBy: 'user-1',
  createdAt: 1,
  updatedAt: 1,
  lastActiveAt: null,
}

function renderComputerTab(state: {
  computer: Computer | null
  ticketUrl?: string | null
}) {
  return renderToStaticMarkup(
    <AgentComputerTabView
      agentName="Research"
      computer={state.computer}
      computerLoading={false}
      computerError={null}
      ticketUrl={state.ticketUrl ?? null}
      ticketError={null}
      ticketLoading={false}
      controlled={false}
      waking={false}
      onWake={() => {}}
      onRetry={() => {}}
      onTakeControl={() => {}}
    />,
  )
}

test('computer tab renders unbound, asleep, connecting, and ready states', () => {
  const unbound = renderComputerTab({ computer: null })
  assert.match(unbound, /No computer/)

  const asleep = renderComputerTab({ computer: { ...computer, status: 'stopped' } })
  assert.match(asleep, /Computer is asleep/)
  assert.match(asleep, />Wake</)

  const connecting = renderComputerTab({ computer: { ...computer, status: 'provisioning' } })
  assert.match(connecting, /Connecting/)

  const ready = renderComputerTab({ computer, ticketUrl: 'https://computer.example/ticket' })
  assert.match(ready, /Take control/)
  assert.match(ready, /Research is working/)
})
