import assert from 'node:assert/strict'
import test from 'node:test'
import type { AutomationGraph } from '@overlay/app-core'
import { AUTOMATION_GRAPH_VERSION } from '@overlay/app-core'
import {
  validateAutomationGraph,
  isAutomationGraphValid,
  addNodeToGraph,
  deleteNodeFromGraph,
  connectNodesInGraph,
  deleteEdgeFromGraph,
  updateNodeInGraph,
  updateNodePositionInGraph,
  createAutomationNode,
  generateNodeId,
  graphFromReactFlowState,
  GraphHistory,
} from './graph-ops'

function validGraph(): AutomationGraph {
  return {
    version: AUTOMATION_GRAPH_VERSION,
    nodes: [
      { id: 'trigger', kind: 'trigger', label: 'Trigger', config: {} },
      { id: 'step1', kind: 'prompt', label: 'Step 1', config: {} },
      { id: 'output', kind: 'output', label: 'Output', config: {} },
    ],
    edges: [
      { from: 'trigger', to: 'step1' },
      { from: 'step1', to: 'output' },
    ],
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('validateAutomationGraph passes for a valid linear graph', () => {
  const errors = validateAutomationGraph(validGraph())
  assert.equal(errors.length, 0)
})

test('isAutomationGraphValid returns true for a valid graph', () => {
  assert.equal(isAutomationGraphValid(validGraph()), true)
})

test('validateAutomationGraph detects missing trigger', () => {
  const graph = validGraph()
  graph.nodes = graph.nodes.filter((n) => n.kind !== 'trigger')
  const errors = validateAutomationGraph(graph)
  assert.ok(errors.some((e) => e.code === 'missing_trigger'))
})

test('validateAutomationGraph detects multiple triggers', () => {
  const graph = validGraph()
  graph.nodes.push({ id: 'trigger2', kind: 'trigger', label: 'Trigger 2', config: {} })
  const errors = validateAutomationGraph(graph)
  assert.ok(errors.some((e) => e.code === 'multiple_triggers'))
})

test('validateAutomationGraph detects missing output', () => {
  const graph = validGraph()
  graph.nodes = graph.nodes.filter((n) => n.kind !== 'output')
  const errors = validateAutomationGraph(graph)
  assert.ok(errors.some((e) => e.code === 'missing_output'))
})

test('validateAutomationGraph detects cycles', () => {
  const graph: AutomationGraph = {
    version: AUTOMATION_GRAPH_VERSION,
    nodes: [
      { id: 'trigger', kind: 'trigger', label: 'Trigger', config: {} },
      { id: 'a', kind: 'prompt', label: 'A', config: {} },
      { id: 'b', kind: 'prompt', label: 'B', config: {} },
      { id: 'output', kind: 'output', label: 'Output', config: {} },
    ],
    edges: [
      { from: 'trigger', to: 'a' },
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' }, // cycle: a → b → a
      { from: 'b', to: 'output' },
    ],
  }
  const errors = validateAutomationGraph(graph)
  assert.ok(errors.some((e) => e.code === 'cycle_detected'))
})

test('validateAutomationGraph detects dangling edges', () => {
  const graph = validGraph()
  graph.edges.push({ from: 'trigger', to: 'nonexistent' })
  const errors = validateAutomationGraph(graph)
  assert.ok(errors.some((e) => e.code === 'dangling_edge'))
})

test('validateAutomationGraph detects trigger with incoming edge', () => {
  const graph = validGraph()
  graph.edges.push({ from: 'output', to: 'trigger' })
  const errors = validateAutomationGraph(graph)
  assert.ok(errors.some((e) => e.code === 'trigger_has_incoming'))
})

test('validateAutomationGraph passes for branching graph with multiple outputs', () => {
  const graph: AutomationGraph = {
    version: AUTOMATION_GRAPH_VERSION,
    nodes: [
      { id: 'trigger', kind: 'trigger', label: 'Trigger', config: {} },
      { id: 'check', kind: 'condition', label: 'Check', config: {} },
      { id: 'yes', kind: 'prompt', label: 'Yes', config: {} },
      { id: 'no', kind: 'prompt', label: 'No', config: {} },
      { id: 'out1', kind: 'output', label: 'Output 1', config: {} },
      { id: 'out2', kind: 'output', label: 'Output 2', config: {} },
    ],
    edges: [
      { from: 'trigger', to: 'check' },
      { from: 'check', to: 'yes', condition: 'yes' },
      { from: 'check', to: 'no', condition: 'no' },
      { from: 'yes', to: 'out1' },
      { from: 'no', to: 'out2' },
    ],
  }
  const errors = validateAutomationGraph(graph)
  assert.equal(errors.length, 0)
})

// ---------------------------------------------------------------------------
// Node manipulation
// ---------------------------------------------------------------------------

test('addNodeToGraph adds a node and sets manuallyEdited', () => {
  const original = validGraph()
  const result = addNodeToGraph(original, 'prompt', { label: 'New Step' })
  assert.equal(result.nodes.length, original.nodes.length + 1)
  assert.equal(result.manuallyEdited, true)
  assert.equal(original.manuallyEdited, undefined) // original unchanged
})

test('deleteNodeFromGraph removes node and its edges, sets manuallyEdited', () => {
  const original = validGraph()
  const result = deleteNodeFromGraph(original, 'step1')
  assert.equal(result.nodes.length, 2)
  assert.equal(result.edges.length, 0) // both edges touched step1
  assert.equal(result.manuallyEdited, true)
})

test('connectNodesInGraph adds an edge and sets manuallyEdited', () => {
  const original = validGraph()
  const result = connectNodesInGraph(original, 'trigger', 'output')
  assert.equal(result.edges.length, original.edges.length + 1)
  assert.equal(result.manuallyEdited, true)
})

test('connectNodesInGraph prevents duplicate edges', () => {
  const original = validGraph()
  const result = connectNodesInGraph(original, 'trigger', 'step1')
  assert.equal(result.edges.length, original.edges.length) // no new edge
})

test('connectNodesInGraph prevents self-loops', () => {
  const original = validGraph()
  const result = connectNodesInGraph(original, 'step1', 'step1')
  assert.equal(result.edges.length, original.edges.length)
})

test('connectNodesInGraph prevents cycles', () => {
  const original = validGraph()
  // output → step1 would create a cycle: trigger → step1 → output → step1
  const result = connectNodesInGraph(original, 'output', 'step1')
  assert.equal(result.edges.length, original.edges.length) // no new edge
})

test('deleteEdgeFromGraph removes an edge and sets manuallyEdited', () => {
  const original = validGraph()
  const result = deleteEdgeFromGraph(original, 'trigger', 'step1')
  assert.equal(result.edges.length, 1)
  assert.equal(result.manuallyEdited, true)
})

test('updateNodeInGraph updates node fields and sets manuallyEdited', () => {
  const original = validGraph()
  const result = updateNodeInGraph(original, 'step1', { label: 'Updated Label' })
  const updated = result.nodes.find((n) => n.id === 'step1')
  assert.equal(updated?.label, 'Updated Label')
  assert.equal(result.manuallyEdited, true)
})

test('updateNodeInGraph merges config instead of replacing', () => {
  const original = validGraph()
  original.nodes[1].config = { text: 'original text', modelId: 'model-1' }
  const result = updateNodeInGraph(original, 'step1', { config: { text: 'new text' } })
  const updated = result.nodes.find((n) => n.id === 'step1')
  assert.equal(updated?.config.text, 'new text')
  assert.equal(updated?.config.modelId, 'model-1') // preserved
})

test('updateNodePositionInGraph sets position and manuallyEdited', () => {
  const original = validGraph()
  const result = updateNodePositionInGraph(original, 'step1', { x: 100, y: 200 })
  const updated = result.nodes.find((n) => n.id === 'step1')
  assert.deepEqual(updated?.position, { x: 100, y: 200 })
  assert.equal(result.manuallyEdited, true)
})

// ---------------------------------------------------------------------------
// Node creation
// ---------------------------------------------------------------------------

test('createAutomationNode creates a node with default label', () => {
  const node = createAutomationNode('prompt')
  assert.equal(node.kind, 'prompt')
  assert.equal(node.label, 'Prompt')
  assert.ok(node.id.length > 0)
  assert.deepEqual(node.config, {})
})

test('createAutomationNode respects overrides', () => {
  const node = createAutomationNode('tool', { label: 'Web Search', config: { toolId: 'web_search' } })
  assert.equal(node.label, 'Web Search')
  assert.equal(node.config.toolId, 'web_search')
})

test('generateNodeId produces unique IDs', () => {
  const ids = new Set<string>()
  for (let i = 0; i < 100; i++) {
    ids.add(generateNodeId('prompt'))
  }
  assert.equal(ids.size, 100)
})

// ---------------------------------------------------------------------------
// ReactFlow ↔ AutomationGraph conversion
// ---------------------------------------------------------------------------

test('graphFromReactFlowState converts ReactFlow nodes/edges to AutomationGraph', () => {
  const previous = validGraph()
  const rfNodes = [
    { id: 'trigger', position: { x: 0, y: 0 }, data: { node: previous.nodes[0] } },
    { id: 'step1', position: { x: 50, y: 100 }, data: { node: previous.nodes[1] } },
  ]
  const rfEdges = [
    { source: 'trigger', target: 'step1' },
  ]
  const result = graphFromReactFlowState(rfNodes, rfEdges, previous)
  assert.equal(result.version, AUTOMATION_GRAPH_VERSION)
  assert.equal(result.nodes.length, 2)
  assert.equal(result.edges.length, 1)
  assert.equal(result.manuallyEdited, true)
  assert.deepEqual(result.nodes[0].position, { x: 0, y: 0 })
})

test('graphFromReactFlowState preserves edge conditions from labels', () => {
  const previous = validGraph()
  const rfNodes = previous.nodes.map((n) => ({
    id: n.id,
    position: { x: 0, y: 0 },
    data: { node: n },
  }))
  const rfEdges = [
    { source: 'trigger', target: 'step1', label: 'yes' },
  ]
  const result = graphFromReactFlowState(rfNodes, rfEdges, previous)
  assert.equal(result.edges[0].condition, 'yes')
})

// ---------------------------------------------------------------------------
// Undo/redo history
// ---------------------------------------------------------------------------

test('GraphHistory undo restores previous state', () => {
  const history = new GraphHistory()
  const g1 = validGraph()
  const g2 = addNodeToGraph(g1, 'prompt')
  history.push(g1)
  const undone = history.undo(g2)
  assert.deepEqual(undone, g1)
})

test('GraphHistory redo restores next state', () => {
  const history = new GraphHistory()
  const g1 = validGraph()
  const g2 = addNodeToGraph(g1, 'prompt')
  history.push(g1)
  const undone = history.undo(g2)
  const redone = history.redo(undone)
  assert.deepEqual(redone, g2)
})

test('GraphHistory canUndo/canRedo track state correctly', () => {
  const history = new GraphHistory()
  assert.equal(history.canUndo(), false)
  assert.equal(history.canRedo(), false)
  history.push(validGraph())
  assert.equal(history.canUndo(), true)
  history.undo(validGraph())
  assert.equal(history.canRedo(), true)
})

test('GraphHistory push clears future stack', () => {
  const history = new GraphHistory()
  const g1 = validGraph()
  const g2 = addNodeToGraph(g1, 'prompt')
  const g3 = addNodeToGraph(g2, 'tool')
  history.push(g1)
  history.undo(g2) // now future has g2
  assert.equal(history.canRedo(), true)
  history.push(g3) // new push should clear future
  assert.equal(history.canRedo(), false)
})

test('GraphHistory reset clears both stacks', () => {
  const history = new GraphHistory()
  history.push(validGraph())
  history.reset()
  assert.equal(history.canUndo(), false)
  assert.equal(history.canRedo(), false)
})

test('GraphHistory limits past stack to 50 entries', () => {
  const history = new GraphHistory()
  for (let i = 0; i < 60; i++) {
    history.push(validGraph())
  }
  // Should only retain 50, so 10 undos should work, then stop
  let count = 0
  let current = validGraph()
  while (history.canUndo()) {
    current = history.undo(current)
    count++
  }
  assert.equal(count, 50)
})
