import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'

import { AgentSidebarDetails } from './AgentSidebarDetails'
import { AgentSidebarAdvancedSettings } from './AgentSidebarDetails.parts'
import type { useAgentEditorController } from './AgentEditorPage'

type Controller = ReturnType<typeof useAgentEditorController>

function makeEditor({
  conflict = false,
  busy = false,
  agent = null,
  discardChanges = () => {},
}: {
  conflict?: boolean
  busy?: boolean
  agent?: WorkspaceAgentDirectoryItem | null
  discardChanges?(): void
} = {}) {
  return {
    loading: false,
    connectedAgentsChecked: true,
    connectedAgentsEnabled: false,
    isDefaultMaster: false,
    busy,
    agent,

    computersAvailable: false,
    byo: { initialLoading: false },
    surfaces: { initialLoading: false },
    computer: { initialLoading: false },
    form: {
      instructions: 'Answer clearly and ask questions when details are missing.',
      conflict,
      discardChanges,
      enabledToolGroups: new Set(['memory', 'files']),
      modelId: 'openrouter/free',
    },
    modelField: {
      modelPickerLabel: 'Auto',
      selectableTextModels: [],
      isFreeTier: false,
      isFreeTierWorkspace: false,
      favoriteScope: 'agent',
      textModelsLoading: false,
    },
    runtime: {
      agentType: 'overlay',
      cloudAgent: false,
      legacyHostedRuntime: false,
    },
  } as unknown as Controller
}

function renderDetails() {
  return renderToStaticMarkup(
    <AgentSidebarDetails
      editor={makeEditor()}
      saveFailed={false}
      onRetry={() => {}}
      onBlurSave={() => {}}
    />,
  )
}

test('agent details render collapsed Model, Instructions, Tools, and Advanced sections', () => {
  const html = renderDetails()
  assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 4)
  assert.match(html, />Model</)
  assert.match(html, />Instructions</)
  assert.match(html, />Tools</)
  assert.match(html, />Advanced</)
  assert.match(html, /Auto/)
  assert.match(html, /Answer clearly and ask questions when details are missing\./)
  assert.match(html, /2 on/)
  assert.doesNotMatch(html, /More settings/)
  assert.doesNotMatch(html, /Mention-first is enforced/)
})


test('the sidebar identifies its current Computer operator instead of reporting someone else', () => {
  const editor = {
    computersAvailable: true, isDefaultMaster: true, connectedAgentsEnabled: false,
    runtime: { agentType: 'overlay' },
    form: { name: 'QA agent', permissionMode: 'ask', visibility: 'workspace', enabledToolGroups: new Set(['computer']) },
    computer: { currentUserId: 'qa-operator', computerSize: 'small', computerOpenBusy: false, computerLifecycleBusy: null,
      agentComputer: { id: 'owned-computer', status: 'ready', size: 'small', controlledByUserId: 'qa-operator' } },
    surfaces: { connections: [], bindings: [], loading: false, enabled: false },
  } as unknown as Controller
  const html = renderToStaticMarkup(<AgentSidebarAdvancedSettings editor={editor} />)
  assert.match(html, /You have control\. QA agent is paused\./)
  assert.doesNotMatch(html, /Someone else has control/)
})

test('sidebar conflict recovery discards and reloads the current agent, and is disabled while busy', () => {
  const agent = {
    id: 'agent-1',
    workspaceId: 'workspace-1',
    name: 'Agent',
    createdByPrincipalId: 'principal-1',
    agentRole: 'agent',
  } as WorkspaceAgentDirectoryItem
  let discarded: WorkspaceAgentDirectoryItem | null = null
  const editor = makeEditor({
    conflict: true,
    agent,
    discardChanges: (value) => { discarded = value as WorkspaceAgentDirectoryItem },
  })
  const tree = AgentSidebarDetails({
    editor,
    saveFailed: false,
    onRetry: () => {},
    onBlurSave: () => {},
  })
  const findDiscardButton = (node: React.ReactNode): React.ReactElement | null => {
    if (!React.isValidElement(node)) return null
    const props = node.props as { children?: React.ReactNode }
    if (props.children === 'Discard draft and reload') return node
    return React.Children.toArray(props.children).map(findDiscardButton).find(Boolean) ?? null
  }
  const button = findDiscardButton(tree)
  assert.ok(button)
  const buttonProps = button.props as { disabled?: boolean; onClick?: () => void }
  assert.equal(buttonProps.disabled, false)
  buttonProps.onClick?.()
  assert.equal(discarded, agent)

  const readyHtml = renderToStaticMarkup(<AgentSidebarDetails editor={editor} saveFailed={false} onRetry={() => {}} onBlurSave={() => {}} />)
  assert.match(readyHtml, /role="alert"/)
  assert.match(readyHtml, /Discard draft and reload/)
  assert.doesNotMatch(readyHtml, /<button[^>]*\sdisabled(?:=|\s|>)/)

  const busyHtml = renderToStaticMarkup(<AgentSidebarDetails
    editor={makeEditor({ conflict: true, busy: true, agent })}
    saveFailed={false}
    onRetry={() => {}}
    onBlurSave={() => {}}
  />)
  assert.match(busyHtml, /Discard draft and reload/)
  assert.match(busyHtml, /<button[^>]*\sdisabled(?:=|\s|>)/)
})
