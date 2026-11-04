import assert from 'node:assert/strict'
import test from 'node:test'
import { nativeWorkflowSettingsForReasoning } from './native-workflow-input-builder'

test('native workflow receives saved reasoning while legacy values stay provider-managed', () => {
  assert.deepEqual(nativeWorkflowSettingsForReasoning('high'), { reasoning: 'high' })
  assert.equal(nativeWorkflowSettingsForReasoning(undefined), undefined)
  assert.equal(nativeWorkflowSettingsForReasoning('provider-default'), undefined)
})
