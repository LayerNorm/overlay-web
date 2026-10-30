import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Computer } from '@overlay/workspace-contracts'
import { AgentComputerControlOverlay, AgentComputerTabView } from './AgentComputerTab.parts'

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
  ticketLoading?: boolean
  controlled?: boolean
  currentUserId?: string
  controlBusy?: boolean
  isDefault?: boolean
}) {
  return renderToStaticMarkup(
    <AgentComputerTabView
      agentName="Research"
      isDefault={state.isDefault}
      computer={state.computer}
      computerLoading={false}
      computerError={null}
      ticketUrl={state.ticketUrl ?? null}
      ticketError={null}
      ticketLoading={state.ticketLoading ?? false}
      controlled={state.controlled ?? false}
      currentUserId={state.currentUserId ?? 'user-1'}
      controlBusy={state.controlBusy}
      waking={false}
      onWake={() => {}}
      onRetry={() => {}}
      onTakeControl={() => {}}
      onReleaseControl={() => {}}
    />,
  )
}

test('computer tab renders unbound, asleep, connecting, and ready states', () => {
  const unbound = renderComputerTab({ computer: null })
  assert.match(unbound, /No computer/)

  const asleep = renderComputerTab({ computer: { ...computer, status: 'stopped' } })
  assert.match(asleep, /Computer is asleep/)
  assert.match(asleep, />Wake</)

  const provisioning = renderComputerTab({ computer: { ...computer, status: 'provisioning' } })
  assert.match(provisioning, /Waking up/)
  const starting = renderComputerTab({ computer: { ...computer, status: 'starting' } })
  assert.match(starting, /Connecting/)

  const ready = renderComputerTab({ computer, ticketUrl: 'https://computer.example/ticket' })
  assert.match(ready, /Take control/)
  assert.match(ready, /Research is working/)
  assert.match(ready, /bg-emerald-500/)
})

test('computer captions show Connecting until the stream is ready and You have control when controlled', () => {
  const loadingTicket = renderComputerTab({ computer, ticketLoading: true })
  assert.match(loadingTicket, /Connecting/)
  assert.doesNotMatch(loadingTicket, /Research is working/)

  const missingTicket = renderComputerTab({ computer })
  assert.match(missingTicket, /Connecting/)
  assert.doesNotMatch(missingTicket, /Research is working/)

  const controlled = renderComputerTab({
    computer: { ...computer, controlledByUserId: 'user-1' },
    ticketUrl: 'https://computer.example/ticket',
    controlled: true,
  })
  assert.match(controlled, /You have control\. Research is paused\./)
  assert.match(controlled, /Release control/)
  assert.match(controlled, /bg-emerald-500/)
  assert.doesNotMatch(controlled, /Research is working/)
})

test('computer unavailable state does not render a preview or invoke computer actions', () => {
  const calls: string[] = []
  const markup = renderToStaticMarkup(
    <AgentComputerTabView
      agentName="Research"
      unavailable
      computer={null}
      computerLoading
      computerError={null}
      ticketUrl={null}
      ticketError={null}
      ticketLoading={false}
      controlled={false}
      waking={false}
      onWake={() => calls.push('wake')}
      onRetry={() => calls.push('retry')}
      onTakeControl={() => calls.push('take-control')}
      onReleaseControl={() => calls.push('release-control')}
    />,
  )
  assert.match(markup, /Computer unavailable/)
  assert.doesNotMatch(markup, /Take control|iframe/)
  assert.deepEqual(calls, [])
})

test('persisted self-control can be resumed or released after reload', () => {
  const markup = renderComputerTab({
    computer: { ...computer, controlledByUserId: 'user-1' },
    ticketUrl: 'https://computer.example/ticket',
  })
  assert.match(markup, /You have control\. Research is paused\./)
  assert.doesNotMatch(markup, /Research is working/)
  assert.match(markup, /aria-label="Resume control"/)
  assert.match(markup, /Resume control/)
  assert.match(markup, /Release control/)
  assert.doesNotMatch(markup, /Take control/)
})

test('another member control is reported without a takeover action', () => {
  const markup = renderComputerTab({
    computer: { ...computer, controlledByUserId: 'user-2' },
    ticketUrl: 'https://computer.example/ticket',
  })
  assert.match(markup, /Research is paused\. Another member has control\./)
  assert.doesNotMatch(markup, /Take control|Resume control|Release control/)
})

test('control actions are disabled while server confirmation is pending', () => {
  const markup = renderComputerTab({ computer, ticketUrl: 'https://computer.example/ticket', controlBusy: true })
  assert.match(markup, /aria-label="Take control"[^>]*disabled/)
  assert.match(markup, /Taking control/)
  const overlay = renderToStaticMarkup(<AgentComputerControlOverlay
    computerName="Research" ticketUrl="https://computer.example/ticket" controlBusy onClose={() => {}}
  />)
  assert.match(overlay, /aria-label="Back to conversation"[^>]*disabled/)
  assert.match(overlay, /disabled[^>]*>Releasing control/)

  const selfControlled = renderComputerTab({
    computer: { ...computer, controlledByUserId: 'user-1' },
    ticketUrl: 'https://computer.example/ticket',
    controlBusy: true,
  })
  assert.match(selfControlled, /disabled[^>]*>Releasing control\.\.\./)
})

test('default-agent sleeping computer uses the blinking brand avatar', () => {
  const html = renderComputerTab({ computer: { ...computer, status: 'stopped' }, isDefault: true })
  assert.match(html, /overlay-mark--blink/)
})
