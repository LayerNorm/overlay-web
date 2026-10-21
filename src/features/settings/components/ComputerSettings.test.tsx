import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Computer } from '@overlay/workspace-contracts'
import { ComputerSettingsCard } from './ComputerSettings'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const computer: Computer = {
  id: 'cmp_1',
  workspaceId: 'ws_1',
  ownerType: 'user',
  ownerId: 'user_1',
  provider: 'box',
  providerRef: 'box_1',
  size: 'default',
  status: 'ready',
  name: 'Personal computer',
  createdBy: 'user_1',
  createdAt: 1,
  updatedAt: 1,
  lastActiveAt: null,
}

const props = {
  agentNames: {},
  userId: 'user_1',
  busy: false,
  controlBusy: false,
  onControl: () => undefined,
  onOpenDesktop: () => undefined,
  onSetRunning: () => undefined,
  onDelete: () => undefined,
}

test('Settings computer card renders take control and hand back states', () => {
  const uncontrolled = renderToStaticMarkup(
    <ComputerSettingsCard computer={computer} {...props} />,
  )
  assert.match(uncontrolled, /Take control/)

  const controlled = renderToStaticMarkup(
    <ComputerSettingsCard
      computer={{ ...computer, controlledByUserId: 'user_1', controlTakenAt: 2 }}
      {...props}
    />,
  )
  assert.match(controlled, /Hand back/)
  assert.match(controlled, /You have control\./)
})
