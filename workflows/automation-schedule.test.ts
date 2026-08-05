import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAutomationUserMessage,
  buildAutomationSystemPrompt,
  buildApprovalToken,
  type AutomationScheduleWorkflowInput,
} from './automation-schedule'

function createTestInput(overrides: Partial<AutomationScheduleWorkflowInput> = {}): AutomationScheduleWorkflowInput {
  return {
    automationId: 'auto_001',
    userId: 'user_001',
    name: 'Daily inbox summary',
    description: 'Summarize my inbox every morning',
    instructions: '1. Check inbox\n2. Summarize mail\n3. Send digest',
    schedule: { kind: 'daily', hourUTC: 9, minuteUTC: 0 },
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

// ---------------------------------------------------------------------------
// buildApprovalToken
// ---------------------------------------------------------------------------

test('buildApprovalToken produces deterministic token for same inputs', () => {
  const token1 = buildApprovalToken('auto_001', 1700000000000)
  const token2 = buildApprovalToken('auto_001', 1700000000000)
  assert.equal(token1, token2)
})

test('buildApprovalToken produces different tokens for different automation IDs', () => {
  const token1 = buildApprovalToken('auto_001', 1700000000000)
  const token2 = buildApprovalToken('auto_002', 1700000000000)
  assert.notEqual(token1, token2)
})

test('buildApprovalToken produces different tokens for different timestamps', () => {
  const token1 = buildApprovalToken('auto_001', 1700000000000)
  const token2 = buildApprovalToken('auto_001', 1700000000001)
  assert.notEqual(token1, token2)
})

test('buildApprovalToken includes automation ID and timestamp', () => {
  const token = buildApprovalToken('auto_001', 1700000000000)
  assert.ok(token.includes('auto_001'))
  assert.ok(token.includes('1700000000000'))
  assert.ok(token.startsWith('automation-approval:'))
})

// ---------------------------------------------------------------------------
// Input type contract
// ---------------------------------------------------------------------------

test('AutomationScheduleWorkflowInput includes all required fields', () => {
  const input = createTestInput()
  assert.equal(typeof input.automationId, 'string')
  assert.equal(typeof input.userId, 'string')
  assert.equal(typeof input.name, 'string')
  assert.equal(typeof input.instructions, 'string')
  assert.equal(typeof input.baseUrl, 'string')
  assert.equal(typeof input.serviceAuthHeader, 'string')
  assert.equal(typeof input.serviceToken, 'string')
  assert.equal(typeof input.actServiceToken, 'string')
  assert.equal(typeof input.finalizeServiceToken, 'string')
  assert.equal(typeof input.schedule, 'object')
})

test('AutomationScheduleWorkflowInput oneShot is optional', () => {
  const input = createTestInput()
  assert.equal(input.oneShot, undefined)
  const oneShotInput = createTestInput({ oneShot: true })
  assert.equal(oneShotInput.oneShot, true)
})

test('AutomationScheduleWorkflowInput approvalRequired is optional', () => {
  const input = createTestInput()
  assert.equal(input.approvalRequired, undefined)
  const approvalInput = createTestInput({ approvalRequired: true, approvalToken: 'test-token' })
  assert.equal(approvalInput.approvalRequired, true)
  assert.equal(approvalInput.approvalToken, 'test-token')
})

test('AutomationScheduleWorkflowInput approvalTimeoutMs is optional', () => {
  const input = createTestInput()
  assert.equal(input.approvalTimeoutMs, undefined)
  const timeoutInput = createTestInput({ approvalTimeoutMs: 60_000 })
  assert.equal(timeoutInput.approvalTimeoutMs, 60_000)
})

test('AutomationScheduleWorkflowInput workspaceId is optional', () => {
  const input = createTestInput()
  assert.equal(input.workspaceId, undefined)
  const wsInput = createTestInput({ workspaceId: 'ws_001' })
  assert.equal(wsInput.workspaceId, 'ws_001')
})

test('AutomationScheduleWorkflowInput conversationId is optional for first run', () => {
  const input = createTestInput()
  assert.equal(input.conversationId, undefined)
  const convInput = createTestInput({ conversationId: 'conv_001' })
  assert.equal(convInput.conversationId, 'conv_001')
})

test('AutomationScheduleWorkflowInput carries the automation run ID for lifecycle sync', () => {
  const input = createTestInput({ runId: 'run_001' })
  assert.equal(input.runId, 'run_001')
})

// ---------------------------------------------------------------------------
// Schedule type contract
// ---------------------------------------------------------------------------

test('AutomationScheduleWorkflowInput accepts interval schedule', () => {
  const input = createTestInput({ schedule: { kind: 'interval', intervalMinutes: 30 } })
  assert.equal(input.schedule.kind, 'interval')
})

test('AutomationScheduleWorkflowInput accepts daily schedule', () => {
  const input = createTestInput({ schedule: { kind: 'daily', hourUTC: 14, minuteUTC: 0 } })
  assert.equal(input.schedule.kind, 'daily')
})

test('AutomationScheduleWorkflowInput accepts weekly schedule', () => {
  const input = createTestInput({ schedule: { kind: 'weekly', dayOfWeekUTC: 1, hourUTC: 9, minuteUTC: 0 } })
  assert.equal(input.schedule.kind, 'weekly')
})

test('AutomationScheduleWorkflowInput accepts monthly schedule', () => {
  const input = createTestInput({ schedule: { kind: 'monthly', dayOfMonthUTC: 15, hourUTC: 9, minuteUTC: 0 } })
  assert.equal(input.schedule.kind, 'monthly')
})
