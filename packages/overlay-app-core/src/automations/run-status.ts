/**
 * Step-to-node mapping and event-to-status reducer for live run visualization.
 *
 * The scheduling workflow has two named steps:
 *   - `waitForApproval` → maps to `condition` nodes
 *   - `executeAutomationRun` → maps to `prompt` + `tool` + `output` nodes
 *
 * The `trigger` node is implicitly `succeeded` when the run starts.
 * Any remaining `pending` nodes are marked `succeeded` when the run completes,
 * or `failed` when the run fails.
 */

import type {
  AutomationGraph,
  AutomationNodeRunStatus,
  AutomationRunEvent,
  AutomationRunStatusSnapshot,
} from '../contracts/automations'

// ---------------------------------------------------------------------------
// Step name → node kind mapping
// ---------------------------------------------------------------------------

/** Workflow step names emitted by the scheduling workflow. */
export const STEP_NAMES = {
  waitForApproval: 'waitForApproval',
  executeAutomationRun: 'executeAutomationRun',
} as const

/** Map a workflow step name to the graph node kinds it affects.
 *
 * The Workflow SDK emits step names with a path prefix like
 * `step//./workflows/automation-schedule//executeAutomationRun`,
 * so we match by suffix/contains rather than exact equality.
 */
function nodeKindsForStep(stepName: string): string[] {
  if (stepName.includes(STEP_NAMES.waitForApproval)) {
    return ['condition']
  }
  if (stepName.includes(STEP_NAMES.executeAutomationRun)) {
    return ['prompt', 'tool', 'output']
  }
  return []
}

// ---------------------------------------------------------------------------
// Event → status reducer
// ---------------------------------------------------------------------------

/**
 * Build an initial empty status snapshot for a graph.
 * All nodes start as `pending`.
 */
export function initialRunStatus(
  graph: AutomationGraph,
  workflowRunId: string,
): AutomationRunStatusSnapshot {
  const nodeStatuses: Record<string, AutomationNodeRunStatus> = {}
  for (const node of graph.nodes) {
    nodeStatuses[node.id] = 'pending'
  }
  return {
    workflowRunId,
    runStatus: 'pending',
    nodeStatuses,
    nodeErrors: {},
    nodeAttempts: {},
    events: [],
    isTerminal: false,
  }
}

/**
 * Apply a single workflow event to a status snapshot, returning the updated snapshot.
 * This is a pure function — the caller is responsible for immutability.
 */
export function applyEvent(
  snapshot: AutomationRunStatusSnapshot,
  graph: AutomationGraph,
  event: AutomationRunEvent,
): AutomationRunStatusSnapshot {
  const nodeStatuses = { ...snapshot.nodeStatuses }
  const nodeErrors = { ...snapshot.nodeErrors }
  const nodeAttempts = { ...snapshot.nodeAttempts }
  const events = [...snapshot.events, event]
  let runStatus = snapshot.runStatus
  let isTerminal = snapshot.isTerminal

  // Find nodes by kind for step mapping
  const nodesByKind = new Map<string, string[]>()
  for (const node of graph.nodes) {
    const existing = nodesByKind.get(node.kind) ?? []
    existing.push(node.id)
    nodesByKind.set(node.kind, existing)
  }

  switch (event.eventType) {
    case 'run_started':
    case 'run_created': {
      runStatus = 'running'
      // Trigger node succeeds immediately when the run starts
      for (const nodeId of nodesByKind.get('trigger') ?? []) {
        nodeStatuses[nodeId] = 'succeeded'
      }
      break
    }
    case 'step_started': {
      const kinds = nodeKindsForStep(event.stepName ?? '')
      for (const kind of kinds) {
        for (const nodeId of nodesByKind.get(kind) ?? []) {
          if (nodeStatuses[nodeId] === 'pending') {
            nodeStatuses[nodeId] = 'running'
          }
        }
      }
      if (event.attempt && event.attempt > 1) {
        for (const kind of kinds) {
          for (const nodeId of nodesByKind.get(kind) ?? []) {
            nodeAttempts[nodeId] = event.attempt
          }
        }
      }
      break
    }
    case 'step_completed': {
      const kinds = nodeKindsForStep(event.stepName ?? '')
      for (const kind of kinds) {
        for (const nodeId of nodesByKind.get(kind) ?? []) {
          if (nodeStatuses[nodeId] === 'running' || nodeStatuses[nodeId] === 'pending') {
            nodeStatuses[nodeId] = 'succeeded'
          }
        }
      }
      break
    }
    case 'step_failed': {
      const kinds = nodeKindsForStep(event.stepName ?? '')
      for (const kind of kinds) {
        for (const nodeId of nodesByKind.get(kind) ?? []) {
          nodeStatuses[nodeId] = 'failed'
          if (event.error) {
            nodeErrors[nodeId] = event.error
          }
        }
      }
      break
    }
    case 'step_retrying': {
      const kinds = nodeKindsForStep(event.stepName ?? '')
      for (const kind of kinds) {
        for (const nodeId of nodesByKind.get(kind) ?? []) {
          nodeStatuses[nodeId] = 'running'
          if (event.error) {
            nodeErrors[nodeId] = event.error
          }
        }
      }
      break
    }
    case 'run_completed': {
      runStatus = 'completed'
      isTerminal = true
      // Mark all remaining pending nodes as succeeded
      for (const [nodeId, status] of Object.entries(nodeStatuses)) {
        if (status === 'pending') {
          nodeStatuses[nodeId] = 'succeeded'
        }
      }
      break
    }
    case 'run_failed': {
      runStatus = 'failed'
      isTerminal = true
      // Mark all remaining pending/running nodes as failed
      for (const [nodeId, status] of Object.entries(nodeStatuses)) {
        if (status === 'pending' || status === 'running') {
          nodeStatuses[nodeId] = 'failed'
          if (event.error && !nodeErrors[nodeId]) {
            nodeErrors[nodeId] = event.error
          }
        }
      }
      break
    }
    case 'run_cancelled': {
      runStatus = 'cancelled'
      isTerminal = true
      // Mark all remaining pending/running nodes as skipped
      for (const [nodeId, status] of Object.entries(nodeStatuses)) {
        if (status === 'pending' || status === 'running') {
          nodeStatuses[nodeId] = 'skipped'
        }
      }
      break
    }
    default:
      // Ignore unrelated events (hook_*, wait_*)
      break
  }

  return {
    workflowRunId: snapshot.workflowRunId,
    runStatus,
    nodeStatuses,
    nodeErrors,
    nodeAttempts,
    events,
    isTerminal,
  }
}

/**
 * Apply a list of events to build a complete status snapshot.
 * Used for replay mode — loads all events and replays them in order.
 */
export function replayEvents(
  graph: AutomationGraph,
  workflowRunId: string,
  events: AutomationRunEvent[],
): AutomationRunStatusSnapshot {
  let snapshot = initialRunStatus(graph, workflowRunId)
  for (const event of events) {
    snapshot = applyEvent(snapshot, graph, event)
  }
  return snapshot
}

/**
 * Replay events up to a specific index (for scrubbing).
 * Returns the snapshot at that point in the timeline.
 */
export function replayEventsUpTo(
  graph: AutomationGraph,
  workflowRunId: string,
  events: AutomationRunEvent[],
  upToIndex: number,
): AutomationRunStatusSnapshot {
  const sliced = events.slice(0, Math.max(0, Math.min(upToIndex, events.length)))
  return replayEvents(graph, workflowRunId, sliced)
}
