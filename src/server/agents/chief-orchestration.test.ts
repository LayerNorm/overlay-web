import assert from 'node:assert/strict'
import test from 'node:test'
import { chiefOrchestrationInstructions } from './chief-orchestration'

test('only explicit Chief roles receive orchestration instructions', () => {
  assert.equal(chiefOrchestrationInstructions(undefined), '')
  assert.equal(chiefOrchestrationInstructions('agent'), '')
  for (const role of ['workspace_chief', 'personal_chief'] as const) {
    const instructions = chiefOrchestrationInstructions(role)
    assert.match(instructions, /Answer simple requests directly/)
    assert.match(instructions, /harness_read_child/)
    assert.match(instructions, /one consolidated answer/)
    assert.match(instructions, /Delegation does not grant access/)
  }
})
