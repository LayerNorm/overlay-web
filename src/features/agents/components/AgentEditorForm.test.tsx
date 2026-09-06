import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AccessSelector,
  AgentTypeSelector,
  ByoAgentFields,
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

test('agent type selector offers overlay and bring-your-own', () => {
  const markup = renderToStaticMarkup(<AgentTypeSelector value="overlay" onChange={() => undefined} />)
  assert.match(markup, /Overlay agent/)
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
