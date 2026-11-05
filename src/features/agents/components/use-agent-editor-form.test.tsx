import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import React, { act, useEffect } from 'react'
import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { getInitialEditorState } from '../lib/agent-editor-state'
import { useAgentEditorForm, type EditableAgent } from './use-agent-editor-form'

const { create } = createRequire(import.meta.url)('react-test-renderer') as {
  create(element: React.ReactElement): {
    update(element: React.ReactElement): void
    unmount(): void
  }
}

function makeAgent(name: string, revision: string): EditableAgent {
  return {
    id: 'agent-1',
    workspaceId: 'workspace-1',
    principalId: 'principal-1',
    name,
    instructions: 'Do the work.',
    harness: 'overlay',
    modelId: 'test-model',
    allowedToolIds: [],
    invocationPolicy: 'mention',
    visibility: 'workspace',
    createdByPrincipalId: 'principal-1',
    createdAt: 1,
    updatedAt: 1,
    teamIds: [],
    roomCount: 0,
    revision,
  } as WorkspaceAgentDirectoryItem & { revision: string }
}

function renderForm(agent: EditableAgent) {
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  let form!: ReturnType<typeof useAgentEditorForm>
  let renderer!: ReturnType<typeof create>
  const noop = () => undefined
  function Probe({ value }: { value: EditableAgent }) {
    const current = useAgentEditorForm({
      initial: getInitialEditorState({ mode: 'edit', agent: value }),
      agent: value,
      activeWorkspaceId: value.workspaceId,
      setLegacyHostedRuntime: noop,
      setAgentType: noop,
    })
    useEffect(() => {
      form = current
    }, [current])
    return null
  }

  return {
    get form() {
      return form
    },
    async start() {
      await act(async () => { renderer = create(<Probe value={agent} />) })
    },
    async update(next: EditableAgent) {
      await act(async () => { renderer.update(<Probe value={next} />) })
    },
    async unmount() {
      await act(async () => { renderer.unmount() })
      if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
      else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
    },
  }
}

test('dirty drafts survive remote revisions and conflict until deliberate discard', async () => {
  const initial = makeAgent('Original', 'revision-1')
  const remote = makeAgent('Remote change', 'revision-2')
  const harness = renderForm(initial)
  await harness.start()
  try {
    await act(async () => {
      harness.form.setName('Local draft')
      harness.form.markDirty()
    })
    await harness.update(remote)
    assert.equal(harness.form.name, 'Local draft')
    assert.equal(harness.form.baseRevision, 'revision-1')
    assert.equal(harness.form.conflict, true)

    const capturedForm = harness.form
    await act(async () => harness.form.discardChanges(remote))
    assert.equal(capturedForm.isBaseRevisionCurrent('revision-1'), false)
    assert.equal(capturedForm.isBaseRevisionCurrent('revision-2'), true)
    assert.equal(harness.form.name, 'Remote change')
    assert.equal(harness.form.baseRevision, 'revision-2')
    assert.equal(harness.form.conflict, false)
    assert.equal(harness.form.dirty, false)
  } finally {
    await harness.unmount()
  }
})

test('a successful in-flight save advances the baseline without replacing newer edits', async () => {
  const initial = makeAgent('Original', 'revision-1')
  const harness = renderForm(initial)
  await harness.start()
  try {
    await act(async () => {
      harness.form.setName('Saved draft')
      harness.form.markDirty()
    })
    const capturedVersion = harness.form.version
    await act(async () => {
      harness.form.setName('Newer local draft')
      harness.form.markDirty()
    })
    await act(async () => harness.form.acceptSavedAgent(
      makeAgent('Saved draft', 'revision-2'),
      capturedVersion,
      'revision-1',
    ))
    assert.equal(harness.form.name, 'Newer local draft')
    assert.equal(harness.form.baseRevision, 'revision-2')
    assert.equal(harness.form.dirty, true)
    assert.equal(harness.form.conflict, false)

    await harness.update(makeAgent('Original', 'revision-1'))
    assert.equal(harness.form.name, 'Newer local draft')
    assert.equal(harness.form.conflict, false)
    await harness.update(makeAgent('Remote after save', 'revision-3'))
    assert.equal(harness.form.name, 'Newer local draft')
    assert.equal(harness.form.conflict, true)
  } finally {
    await harness.unmount()
  }
})

test('a clean save acknowledgement holds accepted fields until the subscribed revision catches up', async () => {
  const initial = makeAgent('Original', 'revision-1')
  const saved = makeAgent('Saved canonical profile', 'revision-2')
  const harness = renderForm(initial)
  await harness.start()
  try {
    await act(async () => {
      harness.form.setName('Saved canonical profile')
      harness.form.markDirty()
    })
    const capturedVersion = harness.form.version
    await act(async () => harness.form.acceptSavedAgent(saved, capturedVersion, 'revision-1'))
    assert.equal(harness.form.name, 'Saved canonical profile')
    assert.equal(harness.form.baseRevision, 'revision-2')
    assert.equal(harness.form.dirty, false)

    await harness.update(initial)
    assert.equal(harness.form.name, 'Saved canonical profile')
    assert.equal(harness.form.baseRevision, 'revision-2')
    assert.equal(harness.form.dirty, false)
    assert.equal(harness.form.conflict, false)

    await harness.update(saved)
    assert.equal(harness.form.name, 'Saved canonical profile')
    assert.equal(harness.form.baseRevision, 'revision-2')
    assert.equal(harness.form.dirty, false)
    assert.equal(harness.form.conflict, false)
  } finally {
    await harness.unmount()
  }
})
