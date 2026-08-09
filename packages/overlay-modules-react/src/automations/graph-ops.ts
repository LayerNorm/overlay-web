import type {
  AutomationGraph,
  AutomationGraphNode,
  AutomationGraphNodeKind,
  AutomationGraphEdge,
} from '@overlay/app-core'
import { AUTOMATION_GRAPH_VERSION } from '@overlay/app-core'

// ---------------------------------------------------------------------------
// Graph validation — ensures structural integrity for the visual editor.
//
// Rules:
//   1. Exactly one `trigger` node (root)
//   2. At least one `output` node
//   3. No cycles (DAG)
//   4. All edges reference existing nodes
//   5. Trigger node has no incoming edges
// ---------------------------------------------------------------------------

export interface AutomationGraphValidationError {
  code:
    | 'missing_trigger'
    | 'multiple_triggers'
    | 'missing_output'
    | 'cycle_detected'
    | 'dangling_edge'
    | 'trigger_has_incoming'
  message: string
}

export function validateAutomationGraph(graph: AutomationGraph): AutomationGraphValidationError[] {
  const errors: AutomationGraphValidationError[] = []

  // 1. Exactly one trigger
  const triggers = graph.nodes.filter((n) => n.kind === 'trigger')
  if (triggers.length === 0) {
    errors.push({ code: 'missing_trigger', message: 'Graph must have a trigger node.' })
  } else if (triggers.length > 1) {
    errors.push({ code: 'multiple_triggers', message: 'Graph must have exactly one trigger node.' })
  }

  // 2. At least one output
  const outputs = graph.nodes.filter((n) => n.kind === 'output')
  if (outputs.length === 0) {
    errors.push({ code: 'missing_output', message: 'Graph must have at least one output node.' })
  }

  // 3. All edges reference existing nodes
  const nodeIds = new Set(graph.nodes.map((n) => n.id))
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      errors.push({
        code: 'dangling_edge',
        message: `Edge ${edge.from}→${edge.to} references a non-existent node.`,
      })
    }
  }

  // 4. Trigger has no incoming edges
  const triggerId = triggers[0]?.id
  if (triggerId) {
    for (const edge of graph.edges) {
      if (edge.to === triggerId) {
        errors.push({
          code: 'trigger_has_incoming',
          message: 'Trigger node cannot have incoming edges.',
        })
        break
      }
    }
  }

  // 5. No cycles (DFS-based detection)
  if (nodeIds.size > 0 && errors.filter((e) => e.code === 'dangling_edge').length === 0) {
    if (hasCycle(graph)) {
      errors.push({ code: 'cycle_detected', message: 'Graph contains a cycle.' })
    }
  }

  return errors
}

export function isAutomationGraphValid(graph: AutomationGraph): boolean {
  return validateAutomationGraph(graph).length === 0
}

function hasCycle(graph: AutomationGraph): boolean {
  const adjacency = new Map<string, string[]>()
  for (const node of graph.nodes) {
    adjacency.set(node.id, [])
  }
  for (const edge of graph.edges) {
    adjacency.get(edge.from)?.push(edge.to)
  }

  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map<string, number>()
  for (const node of graph.nodes) color.set(node.id, WHITE)

  function dfs(id: string): boolean {
    color.set(id, GRAY)
    for (const neighbor of adjacency.get(id) ?? []) {
      const c = color.get(neighbor)
      if (c === GRAY) return true
      if (c === WHITE && dfs(neighbor)) return true
    }
    color.set(id, BLACK)
    return false
  }

  for (const node of graph.nodes) {
    if (color.get(node.id) === WHITE) {
      if (dfs(node.id)) return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Graph manipulation — pure functions for add/delete/connect/update nodes.
// ---------------------------------------------------------------------------

let nodeCounter = 0

export function generateNodeId(kind: AutomationGraphNodeKind): string {
  nodeCounter += 1
  return `${kind}_${Date.now().toString(36)}_${nodeCounter}`
}

const DEFAULT_NODE_LABELS: Record<AutomationGraphNodeKind, string> = {
  trigger: 'Trigger',
  prompt: 'Prompt',
  tool: 'Tool',
  condition: 'Condition',
  output: 'Output',
}

export function createAutomationNode(
  kind: AutomationGraphNodeKind,
  overrides: Partial<AutomationGraphNode> = {},
): AutomationGraphNode {
  return {
    id: overrides.id ?? generateNodeId(kind),
    kind,
    label: overrides.label ?? DEFAULT_NODE_LABELS[kind],
    config: overrides.config ?? {},
    position: overrides.position,
  }
}

export function addNodeToGraph(
  graph: AutomationGraph,
  kind: AutomationGraphNodeKind,
  overrides: Partial<AutomationGraphNode> = {},
): AutomationGraph {
  const node = createAutomationNode(kind, overrides)
  return {
    ...graph,
    nodes: [...graph.nodes, node],
    manuallyEdited: true,
  }
}

export function deleteNodeFromGraph(graph: AutomationGraph, nodeId: string): AutomationGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => n.id !== nodeId),
    edges: graph.edges.filter((e) => e.from !== nodeId && e.to !== nodeId),
    manuallyEdited: true,
  }
}

export function connectNodesInGraph(
  graph: AutomationGraph,
  from: string,
  to: string,
  condition?: string,
): AutomationGraph {
  // Prevent duplicate edges
  const exists = graph.edges.some(
    (e) => e.from === from && e.to === to && e.condition === condition,
  )
  if (exists) return graph

  // Prevent self-loops
  if (from === to) return graph

  const edge: AutomationGraphEdge = { from, to }
  if (condition) edge.condition = condition

  const next = {
    ...graph,
    edges: [...graph.edges, edge],
    manuallyEdited: true,
  }

  // Only add if it doesn't create a cycle
  if (hasCycle(next)) return graph
  return next
}

export function deleteEdgeFromGraph(
  graph: AutomationGraph,
  from: string,
  to: string,
): AutomationGraph {
  return {
    ...graph,
    edges: graph.edges.filter((e) => !(e.from === from && e.to === to)),
    manuallyEdited: true,
  }
}

export function updateNodeInGraph(
  graph: AutomationGraph,
  nodeId: string,
  updates: Partial<AutomationGraphNode>,
): AutomationGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id === nodeId
        ? {
            ...n,
            ...updates,
            config: updates.config ? { ...n.config, ...updates.config } : n.config,
          }
        : n,
    ),
    manuallyEdited: true,
  }
}

export function updateNodePositionInGraph(
  graph: AutomationGraph,
  nodeId: string,
  position: { x: number; y: number },
): AutomationGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id === nodeId ? { ...n, position } : n,
    ),
    manuallyEdited: true,
  }
}

// ---------------------------------------------------------------------------
// ReactFlow ↔ AutomationGraph conversion
// ---------------------------------------------------------------------------

export function graphFromReactFlowState(
  nodes: { id: string; position: { x: number; y: number }; data: { node: AutomationGraphNode } }[],
  edges: { source: string; target: string; label?: string }[],
  previousGraph: AutomationGraph,
): AutomationGraph {
  const graphNodes: AutomationGraphNode[] = nodes.map((rfNode) => ({
    ...rfNode.data.node,
    id: rfNode.id,
    position: rfNode.position,
  }))

  const graphEdges: AutomationGraphEdge[] = edges.map((rfEdge) => ({
    from: rfEdge.source,
    to: rfEdge.target,
    condition: typeof rfEdge.label === 'string' ? rfEdge.label : undefined,
  }))

  return {
    version: AUTOMATION_GRAPH_VERSION,
    nodes: graphNodes,
    edges: graphEdges,
    manuallyEdited: true,
  }
}

// ---------------------------------------------------------------------------
// Undo/redo history stack
// ---------------------------------------------------------------------------

export class GraphHistory {
  private past: AutomationGraph[] = []
  private future: AutomationGraph[] = []

  push(current: AutomationGraph): void {
    this.past.push(current)
    if (this.past.length > 50) this.past.shift()
    this.future = []
  }

  canUndo(): boolean {
    return this.past.length > 0
  }

  canRedo(): boolean {
    return this.future.length > 0
  }

  undo(current: AutomationGraph): AutomationGraph {
    if (this.past.length === 0) return current
    this.future.push(current)
    return this.past.pop()!
  }

  redo(current: AutomationGraph): AutomationGraph {
    if (this.future.length === 0) return current
    this.past.push(current)
    return this.future.pop()!
  }

  reset(): void {
    this.past = []
    this.future = []
  }
}
