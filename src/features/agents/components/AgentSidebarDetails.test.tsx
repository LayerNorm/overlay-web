import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { AgentSidebarDetails } from './AgentSidebarDetails'
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
    surfaces: { initialLoading: false },
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
})
