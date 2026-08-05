import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AutomationGraph, AutomationRunEvent } from '../contracts/automations'
import {
  initialRunStatus,
  applyEvent,
  replayEvents,
  replayEventsUpTo,
  STEP_NAMES,
} from './run-status'

// ---------------------------------------------------------------------------
// Test graph — mirrors the default automation graph structure:
//   trigger → prompt → output
//   trigger → condition → prompt (for approval-gated automations)
// ---------------------------------------------------------------------------

function makeTestGraph(): AutomationGraph {
  return {
    version: 1,
    nodes: [
      { id: 'n-trigger', kind: 'trigger', label: 'Daily trigger', config: {} },
      { id: 'n-prompt', kind: 'prompt', label: 'Write summary', config: {} },
      { id: 'n-output', kind: 'output', label: 'Write to chat', config: {} },
    ],
    edges: [
      { from: 'n-trigger', to: 'n-prompt' },
      { from: 'n-prompt', to: 'n-output' },
    ],
  }
}

function makeApprovalGraph(): AutomationGraph {
  return {
    version: 1,
    nodes: [
      { id: 'n-trigger', kind: 'trigger', label: 'Daily trigger', config: {} },
      { id: 'n-condition', kind: 'condition', label: 'Approval required', config: {} },
      { id: 'n-prompt', kind: 'prompt', label: 'Write summary', config: {} },
      { id: 'n-output', kind: 'output', label: 'Write to chat', config: {} },
    ],
    edges: [
      { from: 'n-trigger', to: 'n-condition' },
      { from: 'n-condition', to: 'n-prompt' },
      { from: 'n-prompt', to: 'n-output' },
    ],
  }
}

function makeEvent(eventType: string, stepName?: string, extra?: Partial<AutomationRunEvent>): AutomationRunEvent {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2)}`,
    eventType,
    stepName,
    createdAt: new Date().toISOString(),
    ...extra,
  }
}

// ---------------------------------------------------------------------------

describe('initialRunStatus', () => {
  it('creates a snapshot with all nodes pending', () => {
    const graph = makeTestGraph()
    const snapshot = initialRunStatus(graph, 'wrun_test')
    assert.equal(snapshot.runStatus, 'pending')
    assert.equal(snapshot.isTerminal, false)
    assert.equal(snapshot.events.length, 0)
    assert.deepEqual(snapshot.nodeStatuses, {
      'n-trigger': 'pending',
      'n-prompt': 'pending',
      'n-output': 'pending',
    })
    assert.deepEqual(snapshot.nodeErrors, {})
    assert.deepEqual(snapshot.nodeAttempts, {})
  })
})

describe('applyEvent', () => {
  it('marks trigger as succeeded when run starts', () => {
    const graph = makeTestGraph()
    let snapshot = initialRunStatus(graph, 'wrun_test')
    snapshot = applyEvent(snapshot, graph, makeEvent('run_started'))
    assert.equal(snapshot.runStatus, 'running')
    assert.equal(snapshot.nodeStatuses['n-trigger'], 'succeeded')
    assert.equal(snapshot.nodeStatuses['n-prompt'], 'pending')
  })

  it('marks prompt as running when executeAutomationRun step starts', () => {
    const graph = makeTestGraph()
    let snapshot = initialRunStatus(graph, 'wrun_test')
    snapshot = applyEvent(snapshot, graph, makeEvent('run_started'))
    snapshot = applyEvent(snapshot, graph, makeEvent('step_started', STEP_NAMES.executeAutomationRun))
    assert.equal(snapshot.nodeStatuses['n-prompt'], 'running')
    assert.equal(snapshot.nodeStatuses['n-output'], 'running')
  })

  it('marks prompt and output as succeeded when executeAutomationRun completes', () => {
    const graph = makeTestGraph()
    let snapshot = initialRunStatus(graph, 'wrun_test')
    snapshot = applyEvent(snapshot, graph, makeEvent('run_started'))
    snapshot = applyEvent(snapshot, graph, makeEvent('step_started', STEP_NAMES.executeAutomationRun))
    snapshot = applyEvent(snapshot, graph, makeEvent('step_completed', STEP_NAMES.executeAutomationRun))
    assert.equal(snapshot.nodeStatuses['n-prompt'], 'succeeded')
    assert.equal(snapshot.nodeStatuses['n-output'], 'succeeded')
  })

  it('marks condition as running when waitForApproval step starts', () => {
    const graph = makeApprovalGraph()
    let snapshot = initialRunStatus(graph, 'wrun_test')
    snapshot = applyEvent(snapshot, graph, makeEvent('run_started'))
    snapshot = applyEvent(snapshot, graph, makeEvent('step_started', STEP_NAMES.waitForApproval))
    assert.equal(snapshot.nodeStatuses['n-condition'], 'running')
    assert.equal(snapshot.nodeStatuses['n-prompt'], 'pending')
  })

  it('marks condition as succeeded when waitForApproval completes', () => {
    const graph = makeApprovalGraph()
    let snapshot = initialRunStatus(graph, 'wrun_test')
    snapshot = applyEvent(snapshot, graph, makeEvent('run_started'))
    snapshot = applyEvent(snapshot, graph, makeEvent('step_started', STEP_NAMES.waitForApproval))
    snapshot = applyEvent(snapshot, graph, makeEvent('step_completed', STEP_NAMES.waitForApproval))
    assert.equal(snapshot.nodeStatuses['n-condition'], 'succeeded')
  })

  it('marks nodes as failed on step_failed event', () => {
    const graph = makeTestGraph()
    let snapshot = initialRunStatus(graph, 'wrun_test')
    snapshot = applyEvent(snapshot, graph, makeEvent('run_started'))
    snapshot = applyEvent(snapshot, graph, makeEvent('step_started', STEP_NAMES.executeAutomationRun))
    snapshot = applyEvent(snapshot, graph, makeEvent('step_failed', STEP_NAMES.executeAutomationRun, { error: 'LLM timeout' }))
    assert.equal(snapshot.nodeStatuses['n-prompt'], 'failed')
    assert.equal(snapshot.nodeStatuses['n-output'], 'failed')
    assert.equal(snapshot.nodeErrors['n-prompt'], 'LLM timeout')
  })

  it('marks nodes as running on step_retrying event', () => {
    const graph = makeTestGraph()
    let snapshot = initialRunStatus(graph, 'wrun_test')
    snapshot = applyEvent(snapshot, graph, makeEvent('run_started'))
    snapshot = applyEvent(snapshot, graph, makeEvent('step_started', STEP_NAMES.executeAutomationRun))
    snapshot = applyEvent(snapshot, graph, makeEvent('step_failed', STEP_NAMES.executeAutomationRun, { error: 'timeout' }))
    snapshot = applyEvent(snapshot, graph, makeEvent('step_retrying', STEP_NAMES.executeAutomationRun, { error: 'timeout' }))
    assert.equal(snapshot.nodeStatuses['n-prompt'], 'running')
    assert.equal(snapshot.nodeErrors['n-prompt'], 'timeout')
  })

  it('tracks attempt count on step_started with attempt > 1', () => {
    const graph = makeTestGraph()
    let snapshot = initialRunStatus(graph, 'wrun_test')
    snapshot = applyEvent(snapshot, graph, makeEvent('run_started'))
    snapshot = applyEvent(snapshot, graph, makeEvent('step_started', STEP_NAMES.executeAutomationRun, { attempt: 2 }))
    assert.equal(snapshot.nodeAttempts['n-prompt'], 2)
  })

  it('marks all remaining pending nodes as succeeded on run_completed', () => {
    const graph = makeTestGraph()
    let snapshot = initialRunStatus(graph, 'wrun_test')
    snapshot = applyEvent(snapshot, graph, makeEvent('run_started'))
    snapshot = applyEvent(snapshot, graph, makeEvent('run_completed'))
    assert.equal(snapshot.runStatus, 'completed')
    assert.equal(snapshot.isTerminal, true)
    assert.equal(snapshot.nodeStatuses['n-trigger'], 'succeeded')
    assert.equal(snapshot.nodeStatuses['n-prompt'], 'succeeded')
    assert.equal(snapshot.nodeStatuses['n-output'], 'succeeded')
  })

  it('marks all remaining pending/running nodes as failed on run_failed', () => {
    const graph = makeTestGraph()
    let snapshot = initialRunStatus(graph, 'wrun_test')
    snapshot = applyEvent(snapshot, graph, makeEvent('run_started'))
    snapshot = applyEvent(snapshot, graph, makeEvent('step_started', STEP_NAMES.executeAutomationRun))
    snapshot = applyEvent(snapshot, graph, makeEvent('run_failed', undefined, { error: 'Workflow crashed' }))
    assert.equal(snapshot.runStatus, 'failed')
    assert.equal(snapshot.isTerminal, true)
    assert.equal(snapshot.nodeStatuses['n-prompt'], 'failed')
    assert.equal(snapshot.nodeStatuses['n-output'], 'failed')
    assert.equal(snapshot.nodeErrors['n-prompt'], 'Workflow crashed')
  })

  it('marks all remaining pending/running nodes as skipped on run_cancelled', () => {
    const graph = makeTestGraph()
    let snapshot = initialRunStatus(graph, 'wrun_test')
    snapshot = applyEvent(snapshot, graph, makeEvent('run_started'))
    snapshot = applyEvent(snapshot, graph, makeEvent('step_started', STEP_NAMES.executeAutomationRun))
    snapshot = applyEvent(snapshot, graph, makeEvent('run_cancelled'))
    assert.equal(snapshot.runStatus, 'cancelled')
    assert.equal(snapshot.isTerminal, true)
    assert.equal(snapshot.nodeStatuses['n-prompt'], 'skipped')
    assert.equal(snapshot.nodeStatuses['n-output'], 'skipped')
  })

  it('ignores unrelated events (hook_*, wait_*)', () => {
    const graph = makeTestGraph()
    let snapshot = initialRunStatus(graph, 'wrun_test')
    snapshot = applyEvent(snapshot, graph, makeEvent('run_started'))
    const before = snapshot
    snapshot = applyEvent(snapshot, graph, makeEvent('hook_created'))
    snapshot = applyEvent(snapshot, graph, makeEvent('wait_created'))
    assert.deepEqual(snapshot.nodeStatuses, before.nodeStatuses)
    assert.equal(snapshot.events.length, before.events.length + 2)
  })

  it('accumulates events in the events array', () => {
    const graph = makeTestGraph()
    let snapshot = initialRunStatus(graph, 'wrun_test')
    snapshot = applyEvent(snapshot, graph, makeEvent('run_started'))
    snapshot = applyEvent(snapshot, graph, makeEvent('step_started', STEP_NAMES.executeAutomationRun))
    assert.equal(snapshot.events.length, 2)
    assert.equal(snapshot.events[0].eventType, 'run_started')
    assert.equal(snapshot.events[1].eventType, 'step_started')
  })
})

describe('replayEvents', () => {
  it('replays all events to produce final snapshot', () => {
    const graph = makeTestGraph()
    const events: AutomationRunEvent[] = [
      makeEvent('run_started'),
      makeEvent('step_started', STEP_NAMES.executeAutomationRun),
      makeEvent('step_completed', STEP_NAMES.executeAutomationRun),
      makeEvent('run_completed'),
    ]
    const snapshot = replayEvents(graph, 'wrun_test', events)
    assert.equal(snapshot.runStatus, 'completed')
    assert.equal(snapshot.isTerminal, true)
    assert.equal(snapshot.nodeStatuses['n-trigger'], 'succeeded')
    assert.equal(snapshot.nodeStatuses['n-prompt'], 'succeeded')
    assert.equal(snapshot.nodeStatuses['n-output'], 'succeeded')
    assert.equal(snapshot.events.length, 4)
  })

  it('replays empty events to produce initial snapshot', () => {
    const graph = makeTestGraph()
    const snapshot = replayEvents(graph, 'wrun_test', [])
    assert.equal(snapshot.runStatus, 'pending')
    assert.equal(snapshot.isTerminal, false)
    assert.equal(snapshot.events.length, 0)
  })

  it('handles prefixed step names from the Workflow SDK', () => {
    // The SDK emits step names like `step//./workflows/automation-schedule//executeAutomationRun`
    const graph = makeTestGraph()
    const events: AutomationRunEvent[] = [
      makeEvent('run_started'),
      makeEvent('step_started', 'step//./workflows/automation-schedule//executeAutomationRun'),
      makeEvent('step_completed', 'step//./workflows/automation-schedule//executeAutomationRun'),
      makeEvent('run_completed'),
    ]
    const snapshot = replayEvents(graph, 'wrun_test', events)
    assert.equal(snapshot.runStatus, 'completed')
    assert.equal(snapshot.nodeStatuses['n-prompt'], 'succeeded')
    assert.equal(snapshot.nodeStatuses['n-output'], 'succeeded')
  })
})

describe('replayEventsUpTo', () => {
  it('replays events up to a specific index', () => {
    const graph = makeTestGraph()
    const events: AutomationRunEvent[] = [
      makeEvent('run_started'),
      makeEvent('step_started', STEP_NAMES.executeAutomationRun),
      makeEvent('step_completed', STEP_NAMES.executeAutomationRun),
      makeEvent('run_completed'),
    ]

    // Before any events: all pending
    const s0 = replayEventsUpTo(graph, 'wrun_test', events, 0)
    assert.equal(s0.nodeStatuses['n-trigger'], 'pending')

    // After first event: trigger succeeded
    const s1 = replayEventsUpTo(graph, 'wrun_test', events, 1)
    assert.equal(s1.nodeStatuses['n-trigger'], 'succeeded')
    assert.equal(s1.nodeStatuses['n-prompt'], 'pending')

    // After second event: prompt running
    const s2 = replayEventsUpTo(graph, 'wrun_test', events, 2)
    assert.equal(s2.nodeStatuses['n-prompt'], 'running')

    // After third event: prompt succeeded
    const s3 = replayEventsUpTo(graph, 'wrun_test', events, 3)
    assert.equal(s3.nodeStatuses['n-prompt'], 'succeeded')

    // After all events: run completed
    const s4 = replayEventsUpTo(graph, 'wrun_test', events, 4)
    assert.equal(s4.runStatus, 'completed')
    assert.equal(s4.isTerminal, true)
  })

  it('clamps index to valid range', () => {
    const graph = makeTestGraph()
    const events: AutomationRunEvent[] = [makeEvent('run_started')]
    const sNeg = replayEventsUpTo(graph, 'wrun_test', events, -5)
    assert.equal(sNeg.events.length, 0)
    const sOver = replayEventsUpTo(graph, 'wrun_test', events, 100)
    assert.equal(sOver.events.length, 1)
  })
})
