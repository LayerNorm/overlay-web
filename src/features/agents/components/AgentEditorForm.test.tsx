import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Computer } from '@overlay/workspace-contracts'
import {
  AccessSelector,
  AgentComputerSection,
  OverlayAgentPermissionsField,
  resolveOverlayPermissionModeSelection,
  OverlayAgentFields,
} from './AgentEditorForm'

// Package components compile with the classic JSX runtime under the app's
// tsconfig, so they resolve React from the global.
;(globalThis as typeof globalThis & { React: typeof React }).React = React

const modelField = {
  favoriteScope: 'test-user',
  isFreeTier: false,
  isFreeTierWorkspace: false,
  modelPickerLabel: 'Agent model',
  selectableTextModels: [],
  textModelsLoading: false,
}

test('access selector marks the active mode and explains its effect', () => {
  const everyone = renderToStaticMarkup(<AccessSelector value="workspace" onChange={() => undefined} />)
  assert.match(everyone, /Everyone/)
  assert.match(everyone, /Everyone in this workspace can see/)
  const onlyMe = renderToStaticMarkup(<AccessSelector value="creator" onChange={() => undefined} />)
  assert.match(onlyMe, /Only me/)
  assert.match(onlyMe, /Only you can see, chat with, or @-mention/)
})

test('Overlay agent permissions default to Ask and explain both modes', () => {
  const ask = renderToStaticMarkup(<OverlayAgentPermissionsField value="ask" onChange={() => undefined} />)
  assert.match(ask, /Permissions/)
  assert.match(ask, /Asks before typing, terminal commands, risky clicks and app actions\./)
  const auto = renderToStaticMarkup(<OverlayAgentPermissionsField value="auto" onChange={() => undefined} />)
  assert.match(auto, /Runs everything without asking, including in automations\./)
})

test('Auto permission selection requires confirmation and cancel keeps Ask', () => {
  const pending = resolveOverlayPermissionModeSelection('ask', 'auto', false)
  assert.deepEqual(pending, { mode: 'ask', confirmationRequired: true })
  const cancelled = pending.mode
  assert.equal(cancelled, 'ask')
  assert.deepEqual(resolveOverlayPermissionModeSelection('ask', 'auto', true), {
    mode: 'auto',
    confirmationRequired: false,
  })
  assert.deepEqual(resolveOverlayPermissionModeSelection('auto', 'auto', false), {
    mode: 'auto',
    confirmationRequired: false,
  })
})

test('overlay fields render instructions, tools, and the mention-first note', () => {
  const markup = renderToStaticMarkup(
    <OverlayAgentFields
      instructions="Find evidence."
      onInstructionsChange={() => undefined}
      modelId="test-model"
      onModelChange={() => undefined}
      modelField={modelField}
      enabledToolGroups={new Set()}
      onToggleToolGroup={() => undefined}
      advanced
      onAdvancedChange={() => undefined}
    />,
  )
  assert.match(markup, /Agent instructions/)
  assert.match(markup, /Mention-first is enforced/)
})

const agentComputer: Computer = {
  id: 'cmp_1',
  workspaceId: 'ws_1',
  ownerType: 'agent',
  ownerId: 'agent_1',
  provider: 'box',
  providerRef: 'box_1',
  size: 'large',
  status: 'ready',
  name: 'Scout computer',
  createdBy: 'user_1',
  createdAt: 1,
  updatedAt: 1,
  lastActiveAt: null,
}

const computerSectionProps = {
  size: 'default' as const,
  onSizeChange: () => undefined,
  currentUserId: 'user_1',
  agentName: 'Scout',
  openBusy: false,
  lifecycleBusy: null,
  onOpenDesktop: () => undefined,
  onControl: () => undefined,
  onTogglePower: () => undefined,
  onDelete: () => undefined,
}

test('computer section keeps the size picker hidden until enabled', () => {
  const markup = renderToStaticMarkup(
    <AgentComputerSection enabled={false} computer={null} {...computerSectionProps} />,
  )
  assert.doesNotMatch(markup, /Computer size/)
  assert.doesNotMatch(markup, /Open desktop/)
})

test('computer section offers sizes and explains save-time provisioning', () => {
  const markup = renderToStaticMarkup(
    <AgentComputerSection enabled computer={null} {...computerSectionProps} />,
  )
  assert.match(markup, /aria-label="Computer size"/)
  assert.match(markup, /Created when you save/)
})

test('computer section shows the provisioned desktop and locks the size', () => {
  const markup = renderToStaticMarkup(
    <AgentComputerSection enabled computer={agentComputer} {...computerSectionProps} />,
  )
  assert.match(markup, /Scout computer/)
  assert.match(markup, /ready · large/)
  assert.match(markup, /Open desktop/)
  assert.match(markup, /Take control/)
  assert.match(markup, /grid grid-cols-2 gap-2/)
  assert.doesNotMatch(markup, /border-\(--border\)/)
  assert.doesNotMatch(markup, /aria-label="Computer size"/)
})

test('computer section shows hand back and takeover status for the current user', () => {
  const markup = renderToStaticMarkup(
    <AgentComputerSection
      enabled
      computer={{ ...agentComputer, controlledByUserId: 'user_1', controlTakenAt: 2 }}
      {...computerSectionProps}
    />,
  )
  assert.match(markup, /Hand back/)
  assert.match(markup, /You have control\. Scout is paused\./)
})

test('computer section warns that disabling a provisioned computer deletes it', () => {
  const markup = renderToStaticMarkup(
    <AgentComputerSection enabled={false} computer={agentComputer} {...computerSectionProps} />,
  )
  assert.match(markup, /Saving deletes this computer/)
})

test('overlay fields render the computer accessory under its tool row', () => {
  const markup = renderToStaticMarkup(
    <OverlayAgentFields
      instructions="Find evidence."
      onInstructionsChange={() => undefined}
      modelId="test-model"
      onModelChange={() => undefined}
      modelField={modelField}
      enabledToolGroups={new Set(['computer'])}
      onToggleToolGroup={() => undefined}
      advanced={false}
      onAdvancedChange={() => undefined}
      computer={{ computer: agentComputer, ...computerSectionProps }}
    />,
  )
  // The merged control: one row toggles the grant and the machine together.
  assert.match(markup, /persistent cloud desktop/)
  assert.match(markup, /Scout computer/)
  assert.match(markup, /Open desktop/)
})


test('a recently active stopped Computer shows its stopped state rather than active use', () => {
  const markup = renderToStaticMarkup(<AgentComputerSection enabled
    computer={{ ...agentComputer, status: 'stopped', lastActiveAt: Date.now() }} {...computerSectionProps} />)
  assert.match(markup, /stopped · large/)
  assert.match(markup, /Start computer/)
  assert.doesNotMatch(markup, /Scout is using it/)
})
