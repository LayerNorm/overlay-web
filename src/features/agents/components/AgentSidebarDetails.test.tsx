import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { AgentSidebarDetails } from './AgentSidebarDetails'
import { AgentSidebarAdvancedSettings } from './AgentSidebarDetails.parts'
import type { useAgentEditorController } from './AgentEditorPage'

type Controller = ReturnType<typeof useAgentEditorController>

function renderDetails() {
  const editor = {
    loading: false,
    connectedAgentsChecked: true,
    connectedAgentsEnabled: false,
    isDefaultMaster: false,

    computersAvailable: false,
    byo: { initialLoading: false },
    computer: { initialLoading: false },
    form: {
      instructions: 'Answer clearly and ask questions when details are missing.',
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

  return renderToStaticMarkup(
    <AgentSidebarDetails
      editor={editor}
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
  assert.doesNotMatch(html, /Reachable on|Connect Slack/)
})


test('the sidebar identifies its current Computer operator instead of reporting someone else', () => {
  const editor = {
    computersAvailable: true, isDefaultMaster: true, connectedAgentsEnabled: false,
    runtime: { agentType: 'overlay' },
    form: { name: 'QA agent', permissionMode: 'ask', visibility: 'workspace', enabledToolGroups: new Set(['computer']) },
    computer: { currentUserId: 'qa-operator', computerSize: 'small', computerOpenBusy: false, computerLifecycleBusy: null,
      agentComputer: { id: 'owned-computer', status: 'ready', size: 'small', controlledByUserId: 'qa-operator' } },
  } as unknown as Controller
  const html = renderToStaticMarkup(<AgentSidebarAdvancedSettings editor={editor} />)
  assert.match(html, /You have control\. QA agent is paused\./)
  assert.doesNotMatch(html, /Someone else has control/)
})
