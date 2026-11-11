import assert from 'node:assert/strict'
import test from 'node:test'
import { getAssistantWorkDurationMs } from './assistant-work-duration'

test('completed form edits and submits do not change assistant work duration', () => {
  const completion = { createdAt: 1_000, completedAt: 58_208, updatedAt: 58_208 }
  const edited = { ...completion, updatedAt: 114_242 }
  const submitted = { ...edited, updatedAt: 179_442 }

  assert.equal(getAssistantWorkDurationMs(completion), 57_208)
  assert.equal(getAssistantWorkDurationMs(edited), 57_208)
  assert.equal(getAssistantWorkDurationMs(submitted), 57_208)
})

test('legacy messages fall back to updatedAt and incomplete timestamps stay absent', () => {
  assert.equal(getAssistantWorkDurationMs({ createdAt: 1_000, updatedAt: 58_208 }), 57_208)
  assert.equal(getAssistantWorkDurationMs({ createdAt: 1_000 }), null)
  assert.equal(getAssistantWorkDurationMs({ createdAt: 5_000, updatedAt: 4_000 }), null)
})
