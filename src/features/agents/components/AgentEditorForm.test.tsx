import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Computer } from '@overlay/workspace-contracts'
import type { ManagedHarnessPickerEntry } from '@overlay/api-client'
import {
  AccessSelector,
  AgentBehaviorFields,
  AgentComputerSection,
  AgentTypeSelector,
  ByoAgentFields,
  HostedRuntimeSelector,
  ManagedHarnessFields,
  OverlayAgentFields,
} from './AgentEditorForm'

// Package components compile with the classic JSX runtime under the app's
// tsconfig, so they resolve React from the global.
;(globalThis as typeof globalThis & { React: typeof React }).React = React

test('access selector marks the active mode and explains its effect', () => {
  const everyone = renderToStaticMarkup(<AccessSelector value="workspace" onChange={() => undefined} />)
  assert.match(everyone, /Everyone/)
  assert.match(everyone, /Everyone in this workspace can see/)
  const onlyMe = renderToStaticMarkup(<AccessSelector value="creator" onChange={() => undefined} />)
  assert.match(onlyMe, /Only me/)
  assert.match(onlyMe, /Only you can see, chat with, or @-mention/)
})

test('agent type selector offers hosted Overlay Cloud and bring-your-own', () => {
  const markup = renderToStaticMarkup(<AgentTypeSelector value="overlay" onChange={() => undefined} />)
  assert.match(markup, /Hosted on Overlay Cloud/)
  assert.match(markup, /Bring your own agent/)
})

test('overlay fields render instructions, tools, and the mention-first note', () => {
  const markup = renderToStaticMarkup(
    <OverlayAgentFields
      instructions="Find evidence."
      onInstructionsChange={() => undefined}
      modelId="test-model"
      onModelChange={() => undefined}
      modelOptions={[{ value: 'test-model', label: 'Test model' }]}
      enabledToolGroups={new Set()}
      onToggleToolGroup={() => undefined}
      advanced
      onAdvancedChange={() => undefined}
    />,
  )
  assert.match(markup, /Agent instructions/)
  assert.match(markup, /Mention-first is enforced/)
})

test('byo fields render the harness picker and the empty-environment state', () => {
  const markup = renderToStaticMarkup(
    <ByoAgentFields
      adapterId="codex"
      harnessOptions={[{ id: 'codex', label: 'Codex', description: 'OpenAI coding agent', connectable: true }]}
      onHarnessChange={() => undefined}
      choice="existing"
      onChoiceChange={() => undefined}
      compatibleEnvironments={[]}
      environmentsLoading={false}
      environmentId=""
      onEnvironmentChange={() => undefined}
      workingDirectory=""
      onWorkingDirectoryChange={() => undefined}
      selectedHarnessConnectable
      environmentBusy={null}
      environmentError={null}
      command=""
      copied={false}
      onCopyCommand={() => undefined}
      onBeginConnection={() => undefined}
      setupEnvironment={undefined}
      setupRoots=""
      onSetupRootsChange={() => undefined}
      onApproveSetup={() => undefined}
    />,
  )
  assert.match(markup, /Choose the coding agent Overlay will invoke/)
  assert.match(markup, /No connected environment currently advertises this harness/)
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
  openBusy: false,
  lifecycleBusy: null,
  onOpenDesktop: () => undefined,
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
  assert.doesNotMatch(markup, /aria-label="Computer size"/)
})

test('computer section warns that disabling a provisioned computer deletes it', () => {
  const markup = renderToStaticMarkup(
    <AgentComputerSection enabled={false} computer={agentComputer} {...computerSectionProps} />,
  )
  assert.match(markup, /Saving deletes this computer/)
})

const claudeCodePickerEntry: ManagedHarnessPickerEntry = {
  id: 'claude-code',
  label: 'Claude Code',
  description: "Anthropic's coding agent, running in an isolated Overlay Cloud sandbox.",
  models: [
    { value: 'sonnet', label: 'Claude Sonnet 4.6', harnessModel: 'sonnet', billingModelId: 'claude-sonnet-4-6' },
    { value: 'opus', label: 'Claude Opus 4.7', harnessModel: 'opus', billingModelId: 'anthropic/claude-opus-4.7' },
  ],
  byokProviders: ['user-vercel-ai-gateway'],
}

test('hosted runtime selector lists Overlay first, then managed harnesses', () => {
  const markup = renderToStaticMarkup(
    <HostedRuntimeSelector value="overlay" onChange={() => undefined} harnesses={[claudeCodePickerEntry]} />,
  )
  assert.match(markup, /Models, tools, and memory managed by Overlay/)
  assert.match(markup, /Claude Code/)
  assert.match(markup, /isolated Overlay Cloud sandbox/)
  const overlayIndex = markup.indexOf('>Overlay<')
  const harnessIndex = markup.indexOf('Claude Code')
  assert.ok(overlayIndex >= 0 && harnessIndex > overlayIndex, 'Overlay must render before harness entries')
})

test('managed harness fields render model picker, fixed provider, and working directory', () => {
  const markup = renderToStaticMarkup(
    <ManagedHarnessFields
      harness={claudeCodePickerEntry}
      instructions="Review pull requests."
      onInstructionsChange={() => undefined}
      modelValue="sonnet"
      onModelChange={() => undefined}
      modelAccess="overlay"
      onModelAccessChange={() => undefined}
      byokConnections={[{ id: 'connection-1', label: 'My Vercel AI Gateway' }]}
      provider="Vercel Sandbox"
      workingDirectory="/workspace"
    />,
  )
  assert.match(markup, /Agent instructions/)
  assert.match(markup, /aria-label="Harness model"/)
  assert.match(markup, /aria-label="Model access"/)
  assert.match(markup, /funded by Overlay/)
  assert.match(markup, /Vercel Sandbox/)
  assert.match(markup, /\/workspace/)
  assert.doesNotMatch(markup, /Reset session/, 'create mode has no sandbox yet')
})

test('managed harness fields explain BYOK funding when a connection is selected', () => {
  const markup = renderToStaticMarkup(
    <ManagedHarnessFields
      harness={claudeCodePickerEntry}
      instructions=""
      onInstructionsChange={() => undefined}
      modelValue="opus"
      onModelChange={() => undefined}
      modelAccess="connection-1"
      onModelAccessChange={() => undefined}
      byokConnections={[{ id: 'connection-1', label: 'My Vercel AI Gateway' }]}
      provider="Vercel Sandbox"
      workingDirectory="/workspace"
    />,
  )
  assert.match(markup, /Billed to your own provider connection/)
  assert.match(markup, /stays in Overlay/)
})

test('managed harness fields omit the access picker when the harness has no BYOK providers', () => {
  const markup = renderToStaticMarkup(
    <ManagedHarnessFields
      harness={{ ...claudeCodePickerEntry, byokProviders: [] }}
      instructions=""
      onInstructionsChange={() => undefined}
      modelValue="opus"
      onModelChange={() => undefined}
      modelAccess="overlay"
      onModelAccessChange={() => undefined}
      byokConnections={[]}
      provider="Vercel Sandbox"
      workingDirectory="/workspace"
    />,
  )
  assert.doesNotMatch(markup, /aria-label="Model access"/)
  assert.match(markup, /funded by Overlay/)
})

test('managed harness fields render sandbox status and reset control in edit mode', () => {
  const markup = renderToStaticMarkup(
    <ManagedHarnessFields
      harness={claudeCodePickerEntry}
      instructions=""
      onInstructionsChange={() => undefined}
      modelValue="opus"
      onModelChange={() => undefined}
      modelAccess="overlay"
      onModelAccessChange={() => undefined}
      byokConnections={[]}
      provider="Vercel Sandbox"
      workingDirectory="/workspace"
      sandboxStatus="online"
      onReset={() => undefined}
    />,
  )
  assert.match(markup, /Sandbox/)
  assert.match(markup, /online/)
  assert.match(markup, /Reset session/)
})

const behaviorBase = {
  connectedAgentsEnabled: true,
  computersAvailable: false,
  instructions: 'Do work.',
  onInstructionsChange: () => undefined,
  modelId: 'test-model',
  onModelChange: () => undefined,
  modelOptions: [{ value: 'test-model', label: 'Test model' }],
  enabledToolGroups: new Set<string>(),
  onToggleToolGroup: () => undefined,
  advanced: false,
  onAdvancedChange: () => undefined,
  hostedRuntime: 'overlay',
  onHostedRuntimeChange: () => undefined,
  managedHarnesses: [] as ManagedHarnessPickerEntry[],
  harnessModel: '',
  onHarnessModelChange: () => undefined,
  managedModelAccess: 'overlay',
  onManagedModelAccessChange: () => undefined,
  managedByokConnections: [] as Array<{ id: string; label: string }>,
  managedProvider: 'Vercel Sandbox',
  managedWorkingDirectory: '/workspace',
  adapterId: 'codex',
  harnessOptions: [],
  onHarnessChange: () => undefined,
  environmentChoice: 'existing' as const,
  onEnvironmentChoiceChange: () => undefined,
  compatibleEnvironments: [],
  environmentsLoading: false,
  environmentId: '',
  onEnvironmentChange: () => undefined,
  workingDirectory: '',
  onWorkingDirectoryChange: () => undefined,
  selectedHarnessConnectable: false,
  environmentBusy: null,
  environmentError: null,
  command: '',
  copied: false,
  onCopyCommand: () => undefined,
  onBeginConnection: () => undefined,
  setupRoots: '',
  onSetupRootsChange: () => undefined,
  onApproveSetup: () => undefined,
}

test('behavior fields hide the runtime picker when managed harnesses are gated off', () => {
  const markup = renderToStaticMarkup(
    <AgentBehaviorFields {...behaviorBase} agentType="overlay" />,
  )
  assert.doesNotMatch(markup, /Hosted runtime/)
  assert.match(markup, /Agent instructions/)
})

test('behavior fields swap Overlay-only config for the managed harness form', () => {
  const markup = renderToStaticMarkup(
    <AgentBehaviorFields
      {...behaviorBase}
      agentType="overlay"
      hostedRuntime="claude-code"
      managedHarnesses={[claudeCodePickerEntry]}
      harnessModel="sonnet"
    />,
  )
  assert.match(markup, /aria-label="Hosted runtime"/)
  assert.match(markup, /aria-label="Harness model"/)
  assert.match(markup, /Vercel Sandbox/)
  // Overlay-native controls must not render for a managed runtime.
  assert.doesNotMatch(markup, /aria-label="Agent model"/)
  assert.doesNotMatch(markup, /persistent cloud desktop/)
  // BYO enrollment controls must not leak into the managed branch.
  assert.doesNotMatch(markup, /Create connection/)
  assert.doesNotMatch(markup, /Existing environment/)
})

test('behavior fields hold a managed agent read-only when its runtime is retired', () => {
  const markup = renderToStaticMarkup(
    <AgentBehaviorFields {...behaviorBase} agentType="overlay" hostedRuntime="hermes" />,
  )
  assert.match(markup, /managed agent is unchanged/)
  assert.doesNotMatch(markup, /aria-label="Agent model"/)
})

test('overlay fields render the computer accessory under its tool row', () => {
  const markup = renderToStaticMarkup(
    <OverlayAgentFields
      instructions="Find evidence."
      onInstructionsChange={() => undefined}
      modelId="test-model"
      onModelChange={() => undefined}
      modelOptions={[{ value: 'test-model', label: 'Test model' }]}
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
