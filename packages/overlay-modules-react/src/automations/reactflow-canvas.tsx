'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  ReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  type Connection,
  type NodeChange,
  type EdgeChange,
  Position,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  MarkerType,
} from '@xyflow/react'
import {
  Clock,
  MessageSquare,
  Wrench,
  GitBranch,
  ArrowRight,
  LayoutGrid,
  Plus,
  Undo2,
  Redo2,
  Trash2,
  X,
} from 'lucide-react'
import type {
  AutomationGraph,
  AutomationGraphNode,
  AutomationGraphNodeKind,
  AutomationGraphNodeConfig,
} from '@overlay/app-core'
import { autoLayout, NODE_WIDTH, NODE_HEIGHT } from './auto-layout'
import {
  addNodeToGraph,
  deleteNodeFromGraph,
  connectNodesInGraph,
  deleteEdgeFromGraph,
  updateNodeInGraph,
  updateNodePositionInGraph,
  graphFromReactFlowState,
  validateAutomationGraph,
  GraphHistory,
  type AutomationGraphValidationError,
} from './graph-ops'
import '@xyflow/react/dist/style.css'

// ---------------------------------------------------------------------------
// Node type configuration: icon + label per kind
// ---------------------------------------------------------------------------

const NODE_KIND_CONFIG: Record<
  AutomationGraphNodeKind,
  { icon: typeof Clock; label: string }
> = {
  trigger: { icon: Clock, label: 'Trigger' },
  prompt: { icon: MessageSquare, label: 'Prompt' },
  tool: { icon: Wrench, label: 'Tool' },
  condition: { icon: GitBranch, label: 'Condition' },
  output: { icon: ArrowRight, label: 'Output' },
}

const ADDABLE_KINDS: AutomationGraphNodeKind[] = ['prompt', 'tool', 'condition', 'output']

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
// Node config side panel
// ---------------------------------------------------------------------------

function NodeConfigPanel({
  node,
  onUpdate,
  onClose,
}: {
  node: AutomationGraphNode
  onUpdate: (updates: Partial<AutomationGraphNode>) => void
  onClose: () => void
}) {
  const config = NODE_KIND_CONFIG[node.kind]
  const Icon = config.icon
  const [label, setLabel] = useState(node.label)
  const [text, setText] = useState(node.config.text ?? '')
  const [condition, setCondition] = useState(node.config.condition ?? '')

  useEffect(() => {
    setLabel(node.label)
    setText(node.config.text ?? '')
    setCondition(node.config.condition ?? '')
  }, [node.id, node.label, node.config.text, node.config.condition])

  function commitLabel(value: string) {
    setLabel(value)
    onUpdate({ label: value })
  }

  function commitText(value: string) {
    setText(value)
    onUpdate({ config: { text: value } })
  }

  function commitCondition(value: string) {
    setCondition(value)
    onUpdate({ config: { condition: value } })
  }

  return (
    <div className="flex w-72 flex-col border-l border-[var(--border)] bg-[var(--surface-elevated)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon size={14} strokeWidth={1.75} className="text-[var(--foreground)]" />
          <span className="text-sm font-medium text-[var(--foreground)]">Node settings</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-[var(--muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--foreground)]"
        >
          <X size={14} strokeWidth={1.75} />
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <label className="block text-sm font-medium text-[var(--foreground)]">
          Label
          <input
            value={label}
            onChange={(e) => commitLabel(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--foreground)]"
          />
        </label>
        {node.kind === 'prompt' && (
          <label className="block text-sm font-medium text-[var(--foreground)]">
            Prompt text
            <textarea
              value={text}
              onChange={(e) => commitText(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--foreground)]"
            />
          </label>
        )}
        {node.kind === 'condition' && (
          <label className="block text-sm font-medium text-[var(--foreground)]">
            Condition expression
            <input
              value={condition}
              onChange={(e) => commitCondition(e.target.value)}
              placeholder="e.g. result.success === true"
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--foreground)]"
            />
          </label>
        )}
        {node.kind === 'tool' && (
          <label className="block text-sm font-medium text-[var(--foreground)]">
            Tool ID
            <input
              value={node.config.toolId ?? ''}
              onChange={(e) => onUpdate({ config: { toolId: e.target.value } })}
              placeholder="e.g. web_search"
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--foreground)]"
            />
          </label>
        )}
        {node.kind === 'output' && (
          <label className="block text-sm font-medium text-[var(--foreground)]">
            Output kind
            <input
              value={node.config.outputKind ?? ''}
              onChange={(e) => onUpdate({ config: { outputKind: e.target.value } })}
              placeholder="e.g. chat"
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--foreground)]"
            />
          </label>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add-node toolbar button
// ---------------------------------------------------------------------------

function AddNodeButton({
  kind,
  onAdd,
}: {
  kind: AutomationGraphNodeKind
  onAdd: (kind: AutomationGraphNodeKind) => void
}) {
  const config = NODE_KIND_CONFIG[kind]
  const Icon = config.icon
  return (
    <button
      type="button"
      onClick={() => onAdd(kind)}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] shadow-sm transition-colors hover:bg-[var(--border)]"
    >
      <Icon size={12} strokeWidth={1.75} />
      {config.label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Inner canvas (uses ReactFlow hooks)
// ---------------------------------------------------------------------------

function GraphCanvasInner({
  graph,
  onGraphChange,
}: {
  graph: AutomationGraph
  onGraphChange?: (graph: AutomationGraph) => void
}) {
  const { fitView, screenToFlowPosition } = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<AutomationGraphValidationError[]>([])
  const [, setHistoryVersion] = useState(0)
  const historyRef = useRef(new GraphHistory())
  const currentGraphRef = useRef<AutomationGraph>(graph)
  const skipHistoryRef = useRef(false)

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(() => autoLayout(graph), [graph])

  // Track the last graph we emitted via onGraphChange so we can skip the
  // history reset when the graph prop changes as a result of our own edit.
  const lastEmittedGraphRef = useRef<AutomationGraph | null>(null)

  // Sync from external graph prop (e.g. when automation is loaded/refreshed)
  useEffect(() => {
    // If this graph change came from our own commitGraph, skip history reset
    if (lastEmittedGraphRef.current === graph) {
      currentGraphRef.current = graph
      return
    }
    setNodes(layoutNodes)
    setEdges(layoutEdges)
    currentGraphRef.current = graph
    historyRef.current.reset()
    setHistoryVersion((v) => v + 1)
    setValidationErrors(validateAutomationGraph(graph))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph])

  // Fit view after initial layout
  useEffect(() => {
    const timer = setTimeout(() => fitView({ padding: 0.2, duration: 200 }), 50)
    return () => clearTimeout(timer)
  }, [fitView])

  // --- Commit current ReactFlow state back to AutomationGraph ---
  const commitGraph = useCallback(
    (nextGraph: AutomationGraph) => {
      historyRef.current.push(currentGraphRef.current)
      currentGraphRef.current = nextGraph
      lastEmittedGraphRef.current = nextGraph
      setValidationErrors(validateAutomationGraph(nextGraph))
      setHistoryVersion((v) => v + 1)
      onGraphChange?.(nextGraph)
    },
    [onGraphChange],
  )

  // --- Node changes (drag, select, remove) ---
  const handleNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      const nextNodes = applyNodeChanges(changes, nodes)
      setNodes(nextNodes)

      // Handle deletions
      const removed = changes.filter((c) => c.type === 'remove')
      if (removed.length > 0) {
        let nextGraph = currentGraphRef.current
        for (const change of removed) {
          nextGraph = deleteNodeFromGraph(nextGraph, change.id)
        }
        commitGraph(nextGraph)
        setSelectedNodeId(null)
        return
      }

      // Handle position changes (commit on drag end)
      const positionChanges = changes.filter(
        (c): c is Extract<NodeChange<Node>, { type: 'position' }> =>
          c.type === 'position' && c.dragging === false,
      )
      if (positionChanges.length > 0) {
        let nextGraph = currentGraphRef.current
        for (const change of positionChanges) {
          const updatedNode = nextNodes.find((n) => n.id === change.id)
          if (updatedNode) {
            nextGraph = updateNodePositionInGraph(nextGraph, change.id, updatedNode.position)
          }
        }
        // Position updates don't push to history (too granular)
        currentGraphRef.current = nextGraph
        onGraphChange?.(nextGraph)
      }

      // Handle selection
      const selectionChange = changes.find((c) => c.type === 'select')
      if (selectionChange) {
        setSelectedNodeId(selectionChange.selected ? selectionChange.id : null)
      }
    },
    [nodes, commitGraph, onGraphChange],
  )

  // --- Edge changes ---
  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      const nextEdges = applyEdgeChanges(changes, edges)
      setEdges(nextEdges)

      const removed = changes.filter((c) => c.type === 'remove')
      if (removed.length > 0) {
        let nextGraph = currentGraphRef.current
        for (const change of removed) {
          const edge = edges.find((e) => e.id === change.id)
          if (edge) {
            nextGraph = deleteEdgeFromGraph(nextGraph, edge.source, edge.target)
          }
        }
        commitGraph(nextGraph)
      }
    },
    [edges, commitGraph],
  )

  // --- Connect nodes ---
  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      setEdges((eds) => addEdge({ ...connection, type: 'smoothstep', style: { stroke: 'var(--foreground)', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 } }, eds))
      const nextGraph = connectNodesInGraph(
        currentGraphRef.current,
        connection.source,
        connection.target,
      )
      if (nextGraph !== currentGraphRef.current) {
        commitGraph(nextGraph)
      }
    },
    [setEdges, commitGraph],
  )

  // --- Add node ---
  const handleAddNode = useCallback(
    (kind: AutomationGraphNodeKind) => {
      // Place new node near center of viewport
      const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      const nextGraph = addNodeToGraph(graph, kind, {
        position: { x: center.x - NODE_WIDTH / 2, y: center.y - NODE_HEIGHT / 2 },
      })
      commitGraph(nextGraph)
      // Sync ReactFlow state
      const { nodes: newNodes } = autoLayout(nextGraph)
      setNodes(newNodes)
    },
    [graph, screenToFlowPosition, commitGraph, setNodes],
  )

  // --- Tidy up (reset to auto-layout) ---
  const tidyUp = useCallback(() => {
    setNodes((current) =>
      current.map((node) => {
        const layoutNode = layoutNodes.find((n) => n.id === node.id)
        return layoutNode ? { ...node, position: layoutNode.position } : node
      }),
    )
    // Commit positions back to graph
    let nextGraph = currentGraphRef.current
    for (const layoutNode of layoutNodes) {
      nextGraph = updateNodePositionInGraph(nextGraph, layoutNode.id, layoutNode.position)
    }
    currentGraphRef.current = nextGraph
    onGraphChange?.(nextGraph)
    setTimeout(() => fitView({ padding: 0.2, duration: 200 }), 50)
  }, [layoutNodes, setNodes, fitView, onGraphChange])

  // --- Undo / redo ---
  const undo = useCallback(() => {
    if (!historyRef.current.canUndo()) return
    const prev = historyRef.current.undo(currentGraphRef.current)
    currentGraphRef.current = prev
    lastEmittedGraphRef.current = prev
    setValidationErrors(validateAutomationGraph(prev))
    setHistoryVersion((v) => v + 1)
    const { nodes: undoNodes, edges: undoEdges } = autoLayout(prev)
    setNodes(undoNodes)
    setEdges(undoEdges)
    onGraphChange?.(prev)
  }, [setNodes, setEdges, onGraphChange])

  const redo = useCallback(() => {
    if (!historyRef.current.canRedo()) return
    const next = historyRef.current.redo(currentGraphRef.current)
    currentGraphRef.current = next
    lastEmittedGraphRef.current = next
    setValidationErrors(validateAutomationGraph(next))
    setHistoryVersion((v) => v + 1)
    const { nodes: redoNodes, edges: redoEdges } = autoLayout(next)
    setNodes(redoNodes)
    setEdges(redoEdges)
    onGraphChange?.(next)
  }, [setNodes, setEdges, onGraphChange])

  // --- Delete selected node via keyboard ---
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
        const target = e.target as HTMLElement
        // Don't intercept when typing in an input
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
        e.preventDefault()
        const nextGraph = deleteNodeFromGraph(currentGraphRef.current, selectedNodeId)
        commitGraph(nextGraph)
        setSelectedNodeId(null)
        const { nodes: delNodes, edges: delEdges } = autoLayout(nextGraph)
        setNodes(delNodes)
        setEdges(delEdges)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedNodeId, commitGraph, setNodes, setEdges, undo, redo])

  // --- Update selected node from side panel ---
  const handleUpdateSelectedNode = useCallback(
    (updates: Partial<AutomationGraphNode>) => {
      if (!selectedNodeId) return
      const nextGraph = updateNodeInGraph(currentGraphRef.current, selectedNodeId, updates)
      commitGraph(nextGraph)
      // Update node data in ReactFlow state
      setNodes((current) =>
        current.map((n) => {
          if (n.id !== selectedNodeId) return n
          const existing = (n.data as AutomationNodeData).node
          const updated: AutomationGraphNode = {
            ...existing,
            ...updates,
            config: updates.config ? { ...existing.config, ...updates.config } : existing.config,
          }
          return { ...n, data: { node: updated } }
        }),
      )
    },
    [selectedNodeId, commitGraph, setNodes],
  )

  const selectedNode = selectedNodeId
    ? currentGraphRef.current.nodes.find((n) => n.id === selectedNodeId)
    : null

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
    <div className="flex overflow-hidden rounded-lg border border-[var(--border)]">
      <div className="relative flex-1">
        {/* Toolbar */}
        <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-1.5">
          {ADDABLE_KINDS.map((kind) => (
            <AddNodeButton key={kind} kind={kind} onAdd={handleAddNode} />
          ))}
        </div>
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
          <button
            type="button"
            onClick={undo}
            disabled={!historyRef.current.canUndo()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] shadow-sm transition-colors hover:bg-[var(--border)] disabled:opacity-40"
          >
            <Undo2 size={12} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!historyRef.current.canRedo()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] shadow-sm transition-colors hover:bg-[var(--border)] disabled:opacity-40"
          >
            <Redo2 size={12} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={tidyUp}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] shadow-sm transition-colors hover:bg-[var(--border)]"
          >
            <LayoutGrid size={12} strokeWidth={1.75} />
            Tidy up
          </button>
        </div>

        {/* Validation errors */}
        {validationErrors.length > 0 && (
          <div className="absolute bottom-3 left-3 z-10 max-w-sm rounded-lg border border-red-500/30 bg-[var(--surface-elevated)] px-3 py-2 text-xs text-red-500 shadow-sm">
            {validationErrors[0].message}
          </div>
        )}

        <div className="h-96 overflow-hidden bg-[var(--surface-subtle)]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            nodesDraggable
            nodesConnectable
            elementsSelectable
            panOnDrag
            zoomOnScroll
            zoomOnPinch
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ type: 'smoothstep', style: { stroke: 'var(--foreground)', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 } }}
            deleteKeyCode={null}
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

      {/* Node config side panel */}
      {selectedNode && (
        <NodeConfigPanel
          node={selectedNode}
          onUpdate={handleUpdateSelectedNode}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Exported canvas component (wrapped in ReactFlowProvider)
// ---------------------------------------------------------------------------

export function AutomationGraphCanvas({
  graph,
  onGraphChange,
}: {
  graph: AutomationGraph
  onGraphChange?: (graph: AutomationGraph) => void
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">
        Drag to rearrange, click to select, connect nodes by dragging from handles. Use Tidy up to reset layout. Delete/Backspace removes the selected node. Cmd+Z / Cmd+Shift+Z for undo/redo.
      </p>
      <ReactFlowProvider>
        <GraphCanvasInner graph={graph} onGraphChange={onGraphChange} />
      </ReactFlowProvider>
    </div>
  )
}
