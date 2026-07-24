import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyAutomationRename,
  automationEditorDraftFromDetail,
  automationHref,
  automationStatus,
  buildAutomationSchedule,
  buildAutomationUpdateRequest,
  defaultAutomationGraphSource,
  extractAutomationInstructionSteps,
  getAutomationDisplayName,
  normalizeAutomationDetailTab,
  parseAutomationTime,
  removeAutomationById,
} from './automations'

test('automation sidebar helpers preserve labels, routes, and optimistic state', () => {
  const automations = [
    { _id: 'auto_1', title: 'Draft', enabled: true, createdAt: 1, updatedAt: 1, sourceConversationId: 'chat_1' },
    { _id: 'auto_2', name: 'Daily', enabled: false, createdAt: 1, updatedAt: 1, lastError: 'boom' },
  ]

  assert.equal(getAutomationDisplayName(automations[0]!), 'Draft')
  assert.equal(automationHref(automations[0]!), '/app/automations?id=chat_1&automationId=auto_1')
  assert.equal(automationHref(automations[1]!), '/app/automations?automationId=auto_2')
  assert.deepEqual(automationStatus(automations[0]!), { label: 'Enabled', tone: 'enabled' })
  assert.deepEqual(automationStatus(automations[1]!), { label: 'Error', tone: 'error' })
  assert.equal(applyAutomationRename(automations, 'auto_1', 'Renamed')[0]!.name, 'Renamed')
  assert.deepEqual(removeAutomationById(automations, 'auto_1').map((item) => item._id), ['auto_2'])
})

test('automation editor helpers normalize tabs, instructions, graph source, and draft state', () => {
  const automation = {
    _id: 'auto_1',
    name: 'Morning brief',
    instructions: '1. Check the inbox\n2. Summarize urgent mail',
    enabled: true,
    schedule: { kind: 'daily' as const, hourUTC: 14, minuteUTC: 30 },
    timezone: 'UTC',
    createdAt: 1,
    updatedAt: 1,
  }

  assert.equal(normalizeAutomationDetailTab('graph'), 'edit')
  assert.deepEqual(extractAutomationInstructionSteps(automation.instructions), [
    'Check the inbox',
    'Summarize urgent mail',
  ])
  assert.match(defaultAutomationGraphSource(automation, 'model_a'), /step1/)

  const draft = automationEditorDraftFromDetail(automation, 'model_a')
  assert.equal(draft.name, 'Morning brief')
  assert.equal(draft.modelId, 'model_a')
  assert.equal(draft.scheduleKind, 'daily')
})

test('automation schedule helpers preserve interval and local time conversion contracts', () => {
  assert.deepEqual(parseAutomationTime('25:99'), { hour: 23, minute: 59 })
  assert.deepEqual(
    buildAutomationSchedule({
      kind: 'interval',
      intervalMinutes: 0,
      time: '09:00',
      dayOfWeek: 1,
      dayOfMonth: 1,
      timeZone: 'UTC',
    }),
    { kind: 'interval', intervalMinutes: 60 },
  )
  assert.deepEqual(
    buildAutomationSchedule({
      kind: 'interval',
      intervalMinutes: 5,
      time: '09:00',
      dayOfWeek: 1,
      dayOfMonth: 1,
      timeZone: 'UTC',
    }),
    { kind: 'interval', intervalMinutes: 15 },
  )
  assert.deepEqual(
    buildAutomationSchedule({
      kind: 'daily',
      intervalMinutes: 60,
      time: '09:15',
      dayOfWeek: 1,
      dayOfMonth: 1,
      timeZone: 'UTC',
      nowMs: Date.UTC(2026, 0, 1, 0, 0),
    }),
    { kind: 'daily', hourUTC: 9, minuteUTC: 15 },
  )
})

test('automation update request keeps endpoint body shape typed', () => {
  const automation = {
    _id: 'auto_1',
    name: 'Old',
    instructions: 'Old instructions',
    schedule: { kind: 'daily' as const, hourUTC: 12, minuteUTC: 0 },
    timezone: 'UTC',
    createdAt: 1,
    updatedAt: 1,
  }
  const draft = automationEditorDraftFromDetail(automation, 'model_a')
  const request = buildAutomationUpdateRequest({
    automation,
    draft: {
      ...draft,
      name: 'New',
      instructions: '1. First\n2. Second',
      timezone: 'UTC',
      time: '10:00',
    },
  })

  assert.equal(request.automationId, 'auto_1')
  assert.equal(request.name, 'New')
  assert.equal(request.instructions, '1. First\n2. Second')
  assert.deepEqual(request.schedule, { kind: 'daily', hourUTC: 10, minuteUTC: 0 })
  assert.match(request.graphSource ?? '', /step2/)
})
