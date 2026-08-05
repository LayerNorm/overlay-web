'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  ReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  Position,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react'
import dagre from 'dagre'
import {
  Clock,
  MessageSquare,
  Wrench,
  GitBranch,
  ArrowRight,
  LayoutGrid,
} from 'lucide-react'
import type {
  AutomationGraph,
  AutomationGraphNode,
  AutomationGraphNodeKind,
} from '@overlay/app-core'
import '@xyflow/react/dist/style.css'

// ---------------------------------------------------------------------------
// Node type configuration: icon + accent color per kind
// ---------------------------------------------------------------------------

const NODE_KIND_CONFIG: Record<
  AutomationGraphNodeKind,
  { icon: typeof Clock; label: string; accent: string }
> = {
  trigger: { icon: Clock, label: 'Trigger', accent: 'var(--foreground)' },
  prompt: { icon: MessageSquare, label: 'Prompt', accent: 'var(--foreground)' },
  tool: { icon: Wrench, label: 'Tool', accent: 'var(--foreground)' },
  condition: { icon: GitBranch, label: 'Condition', accent: 'var(--foreground)' },
  output: { icon: ArrowRight, label: 'Output', accent: 'var(--foreground)' },
}

// ---------------------------------------------------------------------------
// Dagre auto-layout
// ---------------------------------------------------------------------------

const NODE_WIDTH = 220
const NODE_HEIGHT = 72
const NODE_GAP_X = 60
const NODE_GAP_Y = 40

function autoLayout(graph: AutomationGraph): { nodes: Node[]; edges: Edge[] } {
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

// ---------------------------------------------------------------------------
// Custom node component
// ---------------------------------------------------------------------------

type AutomationNodeData = { node: AutomationGraphNode }

function AutomationNode({ data, selected }: NodeProps) {
  const { node } = data as AutomationNodeData
  const config = NODE_KIND_CONFIG[node.kind] ?? NODE_KIND_CONFIG.prompt
  const Icon = config.icon
  const isTrigger = node.kind === 'trigger'
  const isOutput = node.kind === 'output'

  return (
    <div
      className={`relative flex items-center gap-3 rounded-xl border bg-[var(--surface-elevated)] px-3 py-2.5 shadow-sm transition-shadow ${
        selected
          ? 'border-[var(--foreground)] ring-1 ring-[var(--foreground)]'
          : 'border-[var(--border)]'
      }`}
      style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
    >
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Top}
          className="!h-2 !w-2 !border-0 !bg-[var(--border)]"
        />
      )}
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)]">
        <Icon size={16} strokeWidth={1.75} className="text-[var(--foreground)]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
          {config.label}
        </p>
        <p className="truncate text-sm font-medium text-[var(--foreground)]">
          {node.label}
        </p>
      </div>
      {!isOutput && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!h-2 !w-2 !border-0 !bg-[var(--border)]"
        />
      )}
    </div>
  )
}

const nodeTypes = { automation: AutomationNode }

// ---------------------------------------------------------------------------
// Inner canvas (uses ReactFlow hooks)
// ---------------------------------------------------------------------------

function GraphCanvasInner({ graph }: { graph: AutomationGraph }) {
  const { fitView } = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(() => autoLayout(graph), [graph])

  useEffect(() => {
    setNodes(layoutNodes)
    setEdges(layoutEdges)
  }, [layoutNodes, layoutEdges, setNodes, setEdges])

  // Fit view after initial layout
  useEffect(() => {
    const timer = setTimeout(() => fitView({ padding: 0.2, duration: 200 }), 50)
    return () => clearTimeout(timer)
  }, [fitView])

  const tidyUp = useCallback(() => {
    // Reset to auto-layout positions (discard manual drags)
    setNodes((current) =>
      current.map((node) => {
        const layoutNode = layoutNodes.find((n) => n.id === node.id)
        return layoutNode ? { ...node, position: layoutNode.position } : node
      }),
    )
    setTimeout(() => fitView({ padding: 0.2, duration: 200 }), 50)
  }, [layoutNodes, setNodes, fitView])

  if (graph.nodes.length === 0) {
    return (
      <div className="flex min-h-72 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)]">
        <div className="flex max-w-md flex-col items-center gap-2 text-center">
          <GitBranch size={18} strokeWidth={1.75} className="text-[var(--muted)]" />
          <p className="text-sm text-[var(--muted)]">
            No automation steps defined yet.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="absolute right-3 top-3 z-10">
        <button
          type="button"
          onClick={tidyUp}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] shadow-sm transition-colors hover:bg-[var(--border)]"
        >
          <LayoutGrid size={12} strokeWidth={1.75} />
          Tidy up
        </button>
      </div>
      <div className="h-80 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: false }}
          defaultEdgeOptions={{ type: 'smoothstep' }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={16}
            size={1}
            color="var(--border)"
          />
          <Controls
            showInteractive={false}
            className="!border-[var(--border)] !bg-[var(--surface-elevated)] !shadow-sm"
          />
        </ReactFlow>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Exported canvas component (wrapped in ReactFlowProvider)
// ---------------------------------------------------------------------------

export function AutomationGraphCanvas({
  graph,
}: {
  graph: AutomationGraph
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">
        Visual overview of the workflow steps. Drag to rearrange, use Tidy up to reset layout.
      </p>
      <ReactFlowProvider>
        <GraphCanvasInner graph={graph} />
      </ReactFlowProvider>
    </div>
  )
}
