import assert from 'node:assert/strict'
import test from 'node:test'
import { autoLayout } from './auto-layout'
import type { AutomationGraph } from '@overlay/app-core'

const emptyGraph: AutomationGraph = {
  version: 1,
  nodes: [],
  edges: [],
}

const linearGraph: AutomationGraph = {
  version: 1,
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

const graphWithPositions: AutomationGraph = {
  version: 1,
  nodes: [
    { id: 'a', kind: 'prompt', label: 'A', config: {}, position: { x: 100, y: 200 } },
    { id: 'b', kind: 'prompt', label: 'B', config: {} },
  ],
  edges: [{ from: 'a', to: 'b' }],
}

const graphWithConditionEdge: AutomationGraph = {
  version: 1,
  nodes: [
    { id: 'trigger', kind: 'trigger', label: 'Trigger', config: {} },
    { id: 'check', kind: 'condition', label: 'Check', config: {} },
    { id: 'yes', kind: 'prompt', label: 'Yes path', config: {} },
    { id: 'no', kind: 'prompt', label: 'No path', config: {} },
    { id: 'output', kind: 'output', label: 'Output', config: {} },
  ],
  edges: [
    { from: 'trigger', to: 'check' },
    { from: 'check', to: 'yes', condition: 'yes' },
    { from: 'check', to: 'no', condition: 'no' },
    { from: 'yes', to: 'output' },
    { from: 'no', to: 'output' },
  ],
}

test('autoLayout returns empty arrays for an empty graph', () => {
  const { nodes, edges } = autoLayout(emptyGraph)
  assert.equal(nodes.length, 0)
  assert.equal(edges.length, 0)
})

test('autoLayout produces one node per graph node and one edge per graph edge', () => {
  const { nodes, edges } = autoLayout(linearGraph)
  assert.equal(nodes.length, 3)
  assert.equal(edges.length, 2)
})

test('autoLayout assigns numeric positions to all nodes', () => {
  const { nodes } = autoLayout(linearGraph)
  for (const node of nodes) {
    assert.equal(typeof node.position.x, 'number')
    assert.equal(typeof node.position.y, 'number')
    assert.ok(!Number.isNaN(node.position.x))
    assert.ok(!Number.isNaN(node.position.y))
  }
})

test('autoLayout preserves manually positioned nodes and auto-layouts the rest', () => {
  const { nodes } = autoLayout(graphWithPositions)
  const nodeA = nodes.find((n) => n.id === 'a')
  const nodeB = nodes.find((n) => n.id === 'b')
  assert.ok(nodeA && nodeB)
  // Node A has a persisted position — should be used as-is
  assert.equal(nodeA.position.x, 100)
  assert.equal(nodeA.position.y, 200)
  // Node B has no persisted position — should get a dagre-computed position
  assert.equal(typeof nodeB.position.x, 'number')
  assert.equal(typeof nodeB.position.y, 'number')
})

test('autoLayout maps edges correctly with source and target', () => {
  const { edges } = autoLayout(linearGraph)
  assert.equal(edges[0].source, 'trigger')
  assert.equal(edges[0].target, 'step1')
  assert.equal(edges[1].source, 'step1')
  assert.equal(edges[1].target, 'output')
})

test('autoLayout includes edge condition as label', () => {
  const { edges } = autoLayout(graphWithConditionEdge)
  const yesEdge = edges.find((e) => e.label === 'yes')
  const noEdge = edges.find((e) => e.label === 'no')
  assert.ok(yesEdge, 'yes condition edge should exist')
  assert.ok(noEdge, 'no condition edge should exist')
})

test('autoLayout uses smoothstep edge type', () => {
  const { edges } = autoLayout(linearGraph)
  for (const edge of edges) {
    assert.equal(edge.type, 'smoothstep')
  }
})

test('autoLayout sets automation node type for all nodes', () => {
  const { nodes } = autoLayout(linearGraph)
  for (const node of nodes) {
    assert.equal(node.type, 'automation')
  }
})

test('autoLayout handles branching graphs with multiple paths to output', () => {
  const { nodes, edges } = autoLayout(graphWithConditionEdge)
  assert.equal(nodes.length, 5)
  assert.equal(edges.length, 5)
  // All nodes should have valid positions
  for (const node of nodes) {
    assert.ok(!Number.isNaN(node.position.x))
    assert.ok(!Number.isNaN(node.position.y))
  }
})
