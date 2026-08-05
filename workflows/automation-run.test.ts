import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAutomationUserMessage,
  buildAutomationSystemPrompt,
  type AutomationRunWorkflowInput,
} from './automation-run'

function createTestInput(overrides: Partial<AutomationRunWorkflowInput> = {}): AutomationRunWorkflowInput {
  return {
    runId: 'run_001',
    userId: 'user_001',
    automationId: 'auto_001',
    name: 'Daily inbox summary',
    description: 'Summarize my inbox every morning',
    instructions: '1. Check inbox\n2. Summarize mail\n3. Send digest',
    turnId: 'automation-run_001-1700000000000',
    scheduledFor: 1700000000000,
    baseUrl: 'http://localhost:3000',
    serviceAuthHeader: 'x-overlay-service-auth',
    serviceToken: 'token-prepare',
    actServiceToken: 'token-act',
    finalizeServiceToken: 'token-finalize',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// buildAutomationUserMessage
// ---------------------------------------------------------------------------

test('buildAutomationUserMessage includes automation name', () => {
  const message = buildAutomationUserMessage(createTestInput())
  assert.ok(message.includes('Daily inbox summary'))
})

test('buildAutomationUserMessage includes instructions', () => {
  const message = buildAutomationUserMessage(createTestInput())
  assert.ok(message.includes('1. Check inbox'))
  assert.ok(message.includes('2. Summarize mail'))
  assert.ok(message.includes('3. Send digest'))
})

test('buildAutomationUserMessage includes scheduled timestamp', () => {
  const message = buildAutomationUserMessage(createTestInput({ scheduledFor: 1700000000000 }))
  assert.ok(message.includes('2023-11-14'))
})

test('buildAutomationUserMessage includes automation ID', () => {
  const message = buildAutomationUserMessage(createTestInput())
  assert.ok(message.includes('auto_001'))
})

test('buildAutomationUserMessage omits description line when description is empty', () => {
  const message = buildAutomationUserMessage(createTestInput({ description: '' }))
  assert.ok(!message.includes('Description:'))
})

test('buildAutomationUserMessage includes description when present', () => {
  const message = buildAutomationUserMessage(createTestInput({ description: 'A custom description' }))
  assert.ok(message.includes('A custom description'))
})

// ---------------------------------------------------------------------------
// buildAutomationSystemPrompt
// ---------------------------------------------------------------------------

test('buildAutomationSystemPrompt instructs not to ask clarifying questions', () => {
  const prompt = buildAutomationSystemPrompt(createTestInput())
  assert.ok(prompt.includes('without asking clarifying questions'))
})

test('buildAutomationSystemPrompt instructs not to create new automations', () => {
  const prompt = buildAutomationSystemPrompt(createTestInput())
  assert.ok(prompt.includes('Do not create, draft, update, pause, delete, or propose a new automation'))
})

test('buildAutomationSystemPrompt includes automation name', () => {
  const prompt = buildAutomationSystemPrompt(createTestInput())
  assert.ok(prompt.includes('Daily inbox summary'))
})

test('buildAutomationSystemPrompt includes description when present', () => {
  const prompt = buildAutomationSystemPrompt(createTestInput({ description: 'Custom desc' }))
  assert.ok(prompt.includes('Custom desc'))
})

test('buildAutomationSystemPrompt omits description line when empty', () => {
  const prompt = buildAutomationSystemPrompt(createTestInput({ description: '' }))
  assert.ok(!prompt.includes('Automation description:'))
})

test('buildAutomationSystemPrompt instructs to end with summary', () => {
  const prompt = buildAutomationSystemPrompt(createTestInput())
  assert.ok(prompt.includes('concise summary of what was completed'))
})

// ---------------------------------------------------------------------------
// Input type contract
// ---------------------------------------------------------------------------

test('AutomationRunWorkflowInput includes all required fields for workflow execution', () => {
  const input = createTestInput()
  // Verify all fields that the workflow steps need are present
  assert.equal(typeof input.runId, 'string')
  assert.equal(typeof input.userId, 'string')
  assert.equal(typeof input.automationId, 'string')
  assert.equal(typeof input.name, 'string')
  assert.equal(typeof input.instructions, 'string')
  assert.equal(typeof input.turnId, 'string')
  assert.equal(typeof input.scheduledFor, 'number')
  assert.equal(typeof input.baseUrl, 'string')
  assert.equal(typeof input.serviceAuthHeader, 'string')
  assert.equal(typeof input.serviceToken, 'string')
  assert.equal(typeof input.actServiceToken, 'string')
  assert.equal(typeof input.finalizeServiceToken, 'string')
})

test('AutomationRunWorkflowInput workspaceId is optional', () => {
  const input = createTestInput()
  assert.equal(input.workspaceId, undefined)
  const inputWithWorkspace = createTestInput({ workspaceId: 'ws_001' })
  assert.equal(inputWithWorkspace.workspaceId, 'ws_001')
})

test('AutomationRunWorkflowInput conversationId is optional for first run', () => {
  const input = createTestInput()
  assert.equal(input.conversationId, undefined)
  const inputWithConv = createTestInput({ conversationId: 'conv_001' })
  assert.equal(inputWithConv.conversationId, 'conv_001')
})
