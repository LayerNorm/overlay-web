import assert from 'node:assert/strict'
import test from 'node:test'
import type { ComponentProps } from 'react'
import { AgentEditorView } from './AgentEditorPage.parts'
import { createAgentEditorPageView } from './AgentEditorPage'

test('AgentEditorPage forwards the controller view props unchanged', () => {
  const form = { name: 'Maya' }
  const props = {
    mode: 'edit',
    title: 'Maya',
    form,
    presentation: 'panel',
    embedded: true,
    inPanel: true,
  } as unknown as ComponentProps<typeof AgentEditorView>
  const element = createAgentEditorPageView(props)

  assert.equal(element.type, AgentEditorView)
  assert.equal(element.props.title, 'Maya')
  assert.equal(element.props.form, form)
  assert.equal(element.props.embedded, true)
})
