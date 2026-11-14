import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAutomationDraftFromTurn } from './automation-drafts'

test('builds the observed monthly UTC output draft without inventing integrations or steps', () => {
  const draft = buildAutomationDraftFromTurn({
    userText: 'Use draft_automation_from_chat for QA-0E-DRAFT: write OK monthly day 1 at 01:00 UTC, no integrations. Draft only; do not create or run it yet.',
    assistantText: 'Monthly automation that outputs OK on the first day of each month at 01:00 UTC.',
    timezone: 'America/Los_Angeles',
  })

  assert.deepEqual(draft.schedule, { kind: 'monthly', dayOfMonthUTC: 1, hourUTC: 1, minuteUTC: 0 })
  assert.equal(draft.timezone, 'America/Los_Angeles')
  assert.deepEqual(draft.detectedIntegrations, [])
  assert.equal(draft.missingFields.includes('Confirm required integrations'), false)
  assert.equal(draft.instructions, '1. Monthly automation that outputs OK on the first day of each month at 01:00 UTC.')
  assert.equal(draft.confidence, 'high')
})

test('captures explicit non-default monthly UTC time and day', () => {
  const draft = buildAutomationDraftFromTurn({
    userText: 'Monthly day 15 at 03:27 UTC, write OK, no integrations.',
    assistantText: 'Write OK.',
  })

  assert.deepEqual(draft.schedule, { kind: 'monthly', dayOfMonthUTC: 15, hourUTC: 3, minuteUTC: 27 })
  assert.deepEqual(draft.detectedIntegrations, [])
  assert.equal(draft.missingFields.length, 0)
})

test('captures a weekly weekday and explicit UTC time', () => {
  const draft = buildAutomationDraftFromTurn({
    userText: 'Every Wednesday at 08:45 UTC, without integrations: summarize the report.',
    assistantText: 'Summarize the report.',
  })

  assert.deepEqual(draft.schedule, { kind: 'weekly', dayOfWeekUTC: 3, hourUTC: 8, minuteUTC: 45 })
  assert.equal(draft.missingFields.length, 0)
})

test('preserves standard interval schedules', () => {
  const hourly = buildAutomationDraftFromTurn({
    userText: 'Run hourly, without integrations: output OK.',
    assistantText: 'Output OK.',
  })
  const minutes = buildAutomationDraftFromTurn({
    userText: 'Every 15 minutes, without integrations: output OK.',
    assistantText: 'Output OK.',
  })

  assert.deepEqual(hourly.schedule, { kind: 'interval', intervalMinutes: 60 })
  assert.deepEqual(minutes.schedule, { kind: 'interval', intervalMinutes: 15 })
  assert.equal(hourly.missingFields.length, 0)
  assert.equal(minutes.missingFields.length, 0)
})

test('explicit user calendar fields win over conflicting assistant summary fields', () => {
  const draft = buildAutomationDraftFromTurn({
    userText: 'Monthly day 12 at 03:25 UTC, write OK, without integrations.',
    assistantText: 'Weekly Friday at 22:45 UTC.',
  })

  assert.deepEqual(draft.schedule, { kind: 'monthly', dayOfMonthUTC: 12, hourUTC: 3, minuteUTC: 25 })
})

test('uses flagged compatibility fallbacks for an absent monthly time or day', () => {
  const missingTime = buildAutomationDraftFromTurn({
    userText: 'Monthly day 3, write OK, without integrations.',
  })
  const missingTimeWithIntegration = buildAutomationDraftFromTurn({
    userText: 'Monthly day 3, write OK via Gmail.',
  })
  const missingDay = buildAutomationDraftFromTurn({
    userText: 'Monthly at 01:00 UTC, write OK, without integrations.',
  })

  assert.deepEqual(missingTime.schedule, { kind: 'monthly', dayOfMonthUTC: 3, hourUTC: 14, minuteUTC: 0 })
  assert.ok(missingTime.missingFields.includes('Confirm schedule time in UTC'))
  assert.equal(missingTime.confidence, 'low')
  assert.deepEqual(missingTimeWithIntegration.detectedIntegrations, ['Gmail'])
  assert.ok(missingTimeWithIntegration.missingFields.includes('Confirm schedule time in UTC'))
  assert.equal(missingTimeWithIntegration.confidence, 'low')
  assert.deepEqual(missingDay.schedule, { kind: 'monthly', dayOfMonthUTC: 1, hourUTC: 1, minuteUTC: 0 })
  assert.ok(missingDay.missingFields.includes('Confirm monthly day'))
})

test('does not clamp invalid UTC times or silently interpret local timezone prose as UTC', () => {
  const invalid = buildAutomationDraftFromTurn({
    userText: 'Monthly day 3 at 25:99 UTC, write OK, without integrations.',
  })
  const local = buildAutomationDraftFromTurn({
    userText: 'Every Monday at 09:30 America/Los_Angeles, write OK, without integrations.',
    timezone: 'UTC',
  })
  const positiveOffset = buildAutomationDraftFromTurn({
    userText: 'Monthly day 3 at 01:00 UTC+5, write OK, without integrations.',
  })
  const negativeOffset = buildAutomationDraftFromTurn({
    userText: 'Monthly day 3 at 01:00 UTC-4, write OK, without integrations.',
  })

  assert.deepEqual(invalid.schedule, { kind: 'monthly', dayOfMonthUTC: 3, hourUTC: 14, minuteUTC: 0 })
  assert.ok(invalid.missingFields.includes('Confirm valid UTC time (HH:mm)'))
  assert.deepEqual(local.schedule, { kind: 'weekly', dayOfWeekUTC: 1, hourUTC: 14, minuteUTC: 0 })
  assert.ok(local.missingFields.includes('Confirm schedule time in UTC'))
  assert.deepEqual(positiveOffset.schedule, { kind: 'monthly', dayOfMonthUTC: 3, hourUTC: 14, minuteUTC: 0 })
  assert.ok(positiveOffset.missingFields.includes('Confirm schedule time in UTC'))
  assert.deepEqual(negativeOffset.schedule, { kind: 'monthly', dayOfMonthUTC: 3, hourUTC: 14, minuteUTC: 0 })
  assert.ok(negativeOffset.missingFields.includes('Confirm schedule time in UTC'))
})

test('flags invalid or conflicting monthly calendar fields', () => {
  const invalidDay = buildAutomationDraftFromTurn({
    userText: 'Monthly day 32 at 01:00 UTC, write OK, without integrations.',
  })
  const conflictingDays = buildAutomationDraftFromTurn({
    userText: 'Monthly day 3 and day 4 at 01:00 UTC, write OK, without integrations.',
  })
  const conflictingTimes = buildAutomationDraftFromTurn({
    userText: 'Monthly day 3 at 01:00 UTC or 02:00 UTC, write OK, without integrations.',
  })

  assert.deepEqual(invalidDay.schedule, { kind: 'monthly', dayOfMonthUTC: 1, hourUTC: 1, minuteUTC: 0 })
  assert.ok(invalidDay.missingFields.includes('Confirm valid monthly day (1-31)'))
  assert.deepEqual(conflictingDays.schedule, { kind: 'monthly', dayOfMonthUTC: 1, hourUTC: 1, minuteUTC: 0 })
  assert.ok(conflictingDays.missingFields.includes('Confirm one monthly day'))
  assert.deepEqual(conflictingTimes.schedule, { kind: 'monthly', dayOfMonthUTC: 3, hourUTC: 14, minuteUTC: 0 })
  assert.ok(conflictingTimes.missingFields.includes('Confirm one UTC schedule time'))
})

test('does not replace invalid user clock or day values with assistant summary values', () => {
  const negativeClock = buildAutomationDraftFromTurn({
    userText: 'Monthly day 3 at -1:00 UTC, write OK, without integrations.',
    assistantText: 'Monthly day 9 at 02:00 UTC.',
  })
  const oversizedClock = buildAutomationDraftFromTurn({
    userText: 'Monthly day 3 at 100:00 UTC, write OK, without integrations.',
    assistantText: 'Monthly day 9 at 02:00 UTC.',
  })
  const negativeDay = buildAutomationDraftFromTurn({
    userText: 'Monthly day -1 at 01:00 UTC, write OK, without integrations.',
    assistantText: 'Monthly day 9 at 02:00 UTC.',
  })
  const oversizedDay = buildAutomationDraftFromTurn({
    userText: 'Monthly day 123 at 01:00 UTC, write OK, without integrations.',
    assistantText: 'Monthly day 9 at 02:00 UTC.',
  })

  assert.deepEqual(negativeClock.schedule, { kind: 'monthly', dayOfMonthUTC: 3, hourUTC: 14, minuteUTC: 0 })
  assert.ok(negativeClock.missingFields.includes('Confirm valid UTC time (HH:mm)'))
  assert.deepEqual(oversizedClock.schedule, { kind: 'monthly', dayOfMonthUTC: 3, hourUTC: 14, minuteUTC: 0 })
  assert.ok(oversizedClock.missingFields.includes('Confirm valid UTC time (HH:mm)'))
  assert.deepEqual(negativeDay.schedule, { kind: 'monthly', dayOfMonthUTC: 1, hourUTC: 1, minuteUTC: 0 })
  assert.ok(negativeDay.missingFields.includes('Confirm valid monthly day (1-31)'))
  assert.deepEqual(oversizedDay.schedule, { kind: 'monthly', dayOfMonthUTC: 1, hourUTC: 1, minuteUTC: 0 })
  assert.ok(oversizedDay.missingFields.includes('Confirm valid monthly day (1-31)'))
})

test('flags unsupported recurrence phrases instead of accepting a contradictory assistant cadence', () => {
  const interval = buildAutomationDraftFromTurn({
    userText: 'Every 2 hours at 09:00 UTC, write OK, without integrations.',
    assistantText: 'Monthly day 1 at 01:00 UTC.',
  })
  const quarterly = buildAutomationDraftFromTurn({
    userText: 'Quarterly at 09:00 UTC, write OK, without integrations.',
    assistantText: 'Weekly Monday at 01:00 UTC.',
  })

  assert.deepEqual(interval.schedule, { kind: 'daily', hourUTC: 9, minuteUTC: 0 })
  assert.ok(interval.missingFields.includes('Confirm supported schedule frequency'))
  assert.equal(interval.confidence, 'low')
  assert.deepEqual(quarterly.schedule, { kind: 'daily', hourUTC: 9, minuteUTC: 0 })
  assert.ok(quarterly.missingFields.includes('Confirm supported schedule frequency'))
  assert.equal(quarterly.confidence, 'low')
})

test('flags a weekday that was not specified for a weekly schedule', () => {
  const draft = buildAutomationDraftFromTurn({
    userText: 'Weekly at 01:00 UTC, output OK, without integrations.',
  })

  assert.deepEqual(draft.schedule, { kind: 'weekly', dayOfWeekUTC: 1, hourUTC: 1, minuteUTC: 0 })
  assert.ok(draft.missingFields.includes('Confirm weekday'))
})

test('flags unresolved and contradictory integration requirements', () => {
  const unknown = buildAutomationDraftFromTurn({
    userText: 'Monthly day 1 at 01:00 UTC, write OK.',
  })
  const explicitNone = buildAutomationDraftFromTurn({
    userText: 'Monthly day 1 at 01:00 UTC, write OK without integrations.',
    assistantText: 'Use Slack to deliver the output.',
  })

  assert.deepEqual(unknown.detectedIntegrations, [])
  assert.ok(unknown.missingFields.includes('Confirm required integrations'))
  assert.deepEqual(explicitNone.detectedIntegrations, [])
  assert.equal(explicitNone.missingFields.includes('Confirm required integrations'), false)
  assert.equal(explicitNone.instructions, '1. Clarify whether the workflow should use an integration')
  assert.ok(explicitNone.missingFields.includes('Resolve conflicting integration instructions'))
  assert.equal(explicitNone.confidence, 'low')
})

test('flags user integration exceptions even when the assistant summary omits the service', () => {
  const slackException = buildAutomationDraftFromTurn({
    userText: 'Monthly day 1 at 01:00 UTC, no integrations except Slack, write OK.',
    assistantText: 'Monthly automation that outputs OK on the first day of each month at 01:00 UTC.',
  })
  const gmailConflict = buildAutomationDraftFromTurn({
    userText: 'Monthly day 1 at 01:00 UTC, no integrations, but send via Gmail.',
    assistantText: 'Monthly automation that outputs OK on the first day of each month at 01:00 UTC.',
  })

  for (const draft of [slackException, gmailConflict]) {
    assert.deepEqual(draft.detectedIntegrations, [])
    assert.ok(draft.missingFields.includes('Resolve conflicting integration instructions'))
    assert.equal(draft.instructions, '1. Clarify whether the workflow should use an integration')
    assert.equal(draft.confidence, 'low')
  }
})

test('preserves assistant workflow and conditional lines verbatim', () => {
  const draft = buildAutomationDraftFromTurn({
    userText: 'Weekly Monday at 01:00 UTC, without integrations.',
    assistantText: '1. Check the source report.\n2. If no new results are found, keep the output empty.\n3. Write "Hello, world!" to disk.',
  })

  assert.equal(
    draft.instructions,
    '1. Check the source report.\n2. If no new results are found, keep the output empty.\n3. Write "Hello, world!" to disk.',
  )
})

test('requests clarification instead of transforming user text or keeping a schedule-only summary', () => {
  const scheduleOnlySummary = buildAutomationDraftFromTurn({
    userText: 'Monthly day 1 at 01:00 UTC, without integrations.',
    assistantText: 'A monthly automation.',
  })
  const noAssistantWorkflow = buildAutomationDraftFromTurn({
    userText: 'Monthly day 1 at 01:00 UTC, write "Hello, world!" to disk, without integrations.',
  })

  for (const draft of [scheduleOnlySummary, noAssistantWorkflow]) {
    assert.equal(draft.instructions, '1. Clarify what this automation should do')
    assert.ok(draft.missingFields.includes('Clarify automation instructions'))
    assert.equal(draft.confidence, 'low')
  }
})

test('distinguishes a daily report task from daily recurrence and retains true cadence conflicts', () => {
  const weeklyReport = buildAutomationDraftFromTurn({
    userText: 'Every Monday at 01:00 UTC summarize the daily report. No integrations.',
    assistantText: 'Summarize the report.',
  })
  const daily = buildAutomationDraftFromTurn({
    userText: 'Run daily at 01:00 UTC, summarize the report. No integrations.',
    assistantText: 'Summarize the report.',
  })
  const conflicting = buildAutomationDraftFromTurn({
    userText: 'Run daily and every Monday at 01:00 UTC, summarize the report. No integrations.',
    assistantText: 'Summarize the report.',
  })

  assert.deepEqual(weeklyReport.schedule, { kind: 'weekly', dayOfWeekUTC: 1, hourUTC: 1, minuteUTC: 0 })
  assert.equal(weeklyReport.missingFields.includes('Confirm schedule frequency'), false)
  assert.deepEqual(daily.schedule, { kind: 'daily', hourUTC: 1, minuteUTC: 0 })
  assert.equal(daily.missingFields.includes('Confirm schedule frequency'), false)
  assert.ok(conflicting.missingFields.includes('Confirm schedule frequency'))
  assert.equal(conflicting.confidence, 'low')
})

test('distinguishes linear prose from Linear integration actions', () => {
  const equation = buildAutomationDraftFromTurn({
    userText: 'Every Monday at 01:00 UTC, write a linear equation, no integrations.',
    assistantText: 'Write a linear equation.',
  })
  const algebra = buildAutomationDraftFromTurn({
    userText: 'Every Monday at 01:00 UTC, use linear algebra, no integrations.',
    assistantText: 'Use linear algebra.',
  })
  const equations = buildAutomationDraftFromTurn({
    userText: 'Every Monday at 01:00 UTC, work with linear equations, no integrations.',
    assistantText: 'Work with linear equations.',
  })
  const conflict = buildAutomationDraftFromTurn({
    userText: 'Every Monday at 01:00 UTC, no integrations. Create a Linear issue.',
    assistantText: 'Create a Linear issue.',
  })
  const integration = buildAutomationDraftFromTurn({
    userText: 'Every Monday at 01:00 UTC, use linear to create an issue.',
    assistantText: 'Use linear to create an issue.',
  })
  const sendToLinear = buildAutomationDraftFromTurn({
    userText: 'Every Monday at 01:00 UTC, no integrations. Send to Linear.',
    assistantText: 'Send to Linear.',
  })

  assert.deepEqual(equation.detectedIntegrations, [])
  assert.equal(equation.instructions, '1. Write a linear equation.')
  assert.equal(equation.missingFields.includes('Resolve conflicting integration instructions'), false)
  assert.equal(algebra.instructions, '1. Use linear algebra.')
  assert.equal(algebra.missingFields.includes('Resolve conflicting integration instructions'), false)
  assert.equal(equations.instructions, '1. Work with linear equations.')
  assert.equal(equations.missingFields.includes('Resolve conflicting integration instructions'), false)
  assert.deepEqual(conflict.detectedIntegrations, [])
  assert.ok(conflict.missingFields.includes('Resolve conflicting integration instructions'))
  assert.equal(conflict.instructions, '1. Clarify whether the workflow should use an integration')
  assert.deepEqual(integration.detectedIntegrations, ['Linear'])
  assert.ok(sendToLinear.missingFields.includes('Resolve conflicting integration instructions'))
})

test('recognizes bare Linear references at clause boundaries', () => {
  const bareUse = buildAutomationDraftFromTurn({
    userText: 'Every Monday at 01:00 UTC, no integrations. Use Linear.',
    assistantText: 'Use Linear.',
  })
  const issuesInLinear = buildAutomationDraftFromTurn({
    userText: 'Every Monday at 01:00 UTC, no integrations. Summarize issues in Linear.',
    assistantText: 'Summarize issues in Linear.',
  })

  assert.ok(bareUse.missingFields.includes('Resolve conflicting integration instructions'))
  assert.equal(bareUse.instructions, '1. Clarify whether the workflow should use an integration')
  assert.ok(issuesInLinear.missingFields.includes('Resolve conflicting integration instructions'))
  assert.equal(issuesInLinear.instructions, '1. Clarify whether the workflow should use an integration')
})

test('does not extend a Linear destination into a following math noun', () => {
  const draft = buildAutomationDraftFromTurn({
    userText: 'Every Monday at 01:00 UTC, send results to linear equations, no integrations.',
    assistantText: 'Send results to linear equations.',
  })

  assert.equal(draft.instructions, '1. Send results to linear equations.')
  assert.equal(draft.missingFields.includes('Resolve conflicting integration instructions'), false)
})

test('recognizes Linear as the target of a query action', () => {
  const mathSearch = buildAutomationDraftFromTurn({
    userText: 'Every Monday at 01:00 UTC, no integrations. Search linear equations for a root.',
    assistantText: 'Search linear equations for a root.',
  })
  const queryActions = ['Search', 'Query', 'Check']

  assert.equal(mathSearch.instructions, '1. Search linear equations for a root.')
  assert.equal(mathSearch.missingFields.includes('Resolve conflicting integration instructions'), false)
  for (const action of queryActions) {
    const workflow = `${action} Linear for overdue issues.`
    const draft = buildAutomationDraftFromTurn({
      userText: `Every Monday at 01:00 UTC, no integrations. ${workflow}`,
      assistantText: workflow,
    })

    assert.ok(draft.missingFields.includes('Resolve conflicting integration instructions'))
    assert.equal(draft.instructions, '1. Clarify whether the workflow should use an integration')
  }
})

test('does not treat weekday and time-only assistant summaries as workflow', () => {
  const scheduleOnly = buildAutomationDraftFromTurn({
    userText: 'Every Monday at 01:00 UTC, write OK, without integrations.',
    assistantText: 'Every Monday at 01:00 UTC.',
  })
  const workflowAndSchedule = buildAutomationDraftFromTurn({
    userText: 'Every Monday at 01:00 UTC, without integrations.',
    assistantText: 'Summarize the daily report every Monday at 01:00 UTC.',
  })

  assert.deepEqual(scheduleOnly.schedule, { kind: 'weekly', dayOfWeekUTC: 1, hourUTC: 1, minuteUTC: 0 })
  assert.equal(scheduleOnly.instructions, '1. Clarify what this automation should do')
  assert.ok(scheduleOnly.missingFields.includes('Clarify automation instructions'))
  assert.equal(scheduleOnly.confidence, 'low')
  assert.equal(workflowAndSchedule.instructions, '1. Summarize the daily report every Monday at 01:00 UTC.')
  assert.equal(workflowAndSchedule.missingFields.length, 0)
  assert.equal(workflowAndSchedule.confidence, 'high')
})

test('recognizes a daily automation as explicit recurrence', () => {
  const draft = buildAutomationDraftFromTurn({
    userText: 'Set up a daily automation at 01:00 UTC to summarize the report. No integrations.',
    assistantText: 'Summarize the report.',
  })

  assert.deepEqual(draft.schedule, { kind: 'daily', hourUTC: 1, minuteUTC: 0 })
  assert.equal(draft.missingFields.includes('Confirm schedule frequency'), false)
})

test('does not treat a weekday connector as executable workflow', () => {
  const scheduleOnly = buildAutomationDraftFromTurn({
    userText: 'Every Monday and Wednesday at 01:00 UTC, write OK, without integrations.',
    assistantText: 'Every Monday and Wednesday at 01:00 UTC.',
  })
  const actualWorkflow = buildAutomationDraftFromTurn({
    userText: 'Every Monday and Wednesday at 01:00 UTC, without integrations.',
    assistantText: 'Summarize the daily report every Monday and Wednesday at 01:00 UTC.',
  })

  assert.equal(scheduleOnly.instructions, '1. Clarify what this automation should do')
  assert.ok(scheduleOnly.missingFields.includes('Clarify automation instructions'))
  assert.equal(actualWorkflow.instructions, '1. Summarize the daily report every Monday and Wednesday at 01:00 UTC.')
})
