import dagre from 'dagre'
import type { Node, Edge } from '@xyflow/react'
import type { AutomationGraph } from '@overlay/app-core'

// ---------------------------------------------------------------------------
// Dagre auto-layout — pure logic, no React or CSS imports.
// Extracted from reactflow-canvas.tsx so it can be unit-tested in isolation.
// ---------------------------------------------------------------------------

export const NODE_WIDTH = 220
export const NODE_HEIGHT = 72
const NODE_GAP_X = 60
const NODE_GAP_Y = 40

export function autoLayout(graph: AutomationGraph): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: NODE_GAP_Y, ranksep: NODE_GAP_X, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const node of graph.nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const edge of graph.edges) {
    g.setEdge(edge.from, edge.to)
  }

  dagre.layout(g)

  const nodes: Node[] = graph.nodes.map((node) => {
    const pos = g.node(node.id)
    return {
      id: node.id,
      type: 'automation',
      position: node.position ?? { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: { node },
      draggable: true,
    }
  })

  const edges: Edge[] = graph.edges.map((edge, i) => ({
    id: `e-${edge.from}-${edge.to}-${i}`,
    source: edge.from,
    target: edge.to,
    type: 'smoothstep',
    label: edge.condition,
    labelStyle: { fill: 'var(--muted)', fontSize: 10, fontWeight: 500 },
    style: { stroke: 'var(--border)', strokeWidth: 1.5 },
  }))

  return { nodes, edges }
}
