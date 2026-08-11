'use client'

import { useState } from 'react'
import { lazy, Suspense } from 'react'
import type { AutomationGraph, AutomationRunSummary } from '@overlay/app-core'
import { Select } from '@overlay/ui/primitives'
import { useRunStatus, useReplayStatus } from './run-viewer-hooks'

const AutomationGraphCanvas = lazy(() =>
  import('./reactflow-canvas').then((mod) => ({ default: mod.AutomationGraphCanvas })),
)

// ---------------------------------------------------------------------------
// RunViewer — shows the ReactFlow canvas with live per-node status updates
// and a replay scrubber for historical runs.
// ---------------------------------------------------------------------------

export interface AutomationRunViewerProps {
  graph: AutomationGraph
  workflowRunId?: string | null
  runs?: AutomationRunSummary[]
  liveEnabled?: boolean
  /**
   * Edit handler for the idle canvas. Supplying it makes this the single flow
   * surface — the editor no longer renders a second canvas of the same graph.
   */
  onGraphChange?: (graph: AutomationGraph) => void
}

export function AutomationRunViewer({
  graph,
  workflowRunId,
  runs,
  liveEnabled = true,
  onGraphChange,
}: AutomationRunViewerProps) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(workflowRunId ?? null)
  const [mode, setMode] = useState<'live' | 'replay'>(
    workflowRunId && liveEnabled ? 'live' : 'replay',
  )

  // Select and go live when a new workflowRunId arrives (e.g. the user clicked
  // "Test automation" and the durable run started). Adjusted during render rather
  // than in an effect: an effect would paint the previous run first and then
  // immediately re-render, and react-hooks/set-state-in-effect rejects it.
  const [syncedWorkflowRunId, setSyncedWorkflowRunId] = useState(workflowRunId ?? null)
  if (workflowRunId && workflowRunId !== syncedWorkflowRunId) {
    setSyncedWorkflowRunId(workflowRunId)
    setSelectedRunId(workflowRunId)
    if (liveEnabled) setMode('live')
  }

  const isLive = mode === 'live' && selectedRunId === workflowRunId

  // Renders bare: the editor wraps this in its own "Flow" card, and nesting a
  // SettingsCard inside one produced a card within a card.
  return (
      <div className="space-y-4">
        {/* Mode selector + run selector */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMode('live')}
              disabled={!workflowRunId}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                mode === 'live'
                  ? 'bg-[var(--surface-muted)] text-[var(--foreground)]'
                  : 'border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--foreground)] hover:bg-[var(--border)]'
              } disabled:opacity-40`}
            >
              Live
            </button>
            <button
              type="button"
              onClick={() => setMode('replay')}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                mode === 'replay'
                  ? 'bg-[var(--surface-muted)] text-[var(--foreground)]'
                  : 'border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--foreground)] hover:bg-[var(--border)]'
              }`}
            >
              Replay
            </button>
          </div>

          {mode === 'replay' && runs && runs.length > 0 && (
            <Select
              value={selectedRunId ?? ''}
              onChange={(e) => setSelectedRunId(e.target.value || null)}
              className="text-xs"
            >
              <option value="">Select a run…</option>
              {runs.filter((r) => r.workflowRunId).map((run) => (
                <option key={run._id} value={run.workflowRunId!}>
                  {run.status} — {new Date(run.scheduledFor).toLocaleString()}
                </option>
              ))}
            </Select>
          )}
          {mode === 'replay' && runs && runs.length > 0 && !runs.some((r) => r.workflowRunId) && (
            <span className="text-xs text-[var(--muted)]">
              No replayable runs yet — trigger a test run first.
            </span>
          )}
        </div>

        {/* Canvas with status overlay */}
        {graph.nodes.length > 0 ? (
          <Suspense
            fallback={
              <div className="h-96 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)]" />
            }
          >
            {isLive && selectedRunId ? (
              <LiveCanvas graph={graph} workflowRunId={selectedRunId} />
            ) : selectedRunId ? (
              <ReplayCanvas graph={graph} workflowRunId={selectedRunId} />
            ) : (
              <AutomationGraphCanvas graph={graph} onGraphChange={onGraphChange} readOnly={!onGraphChange} />
            )}
          </Suspense>
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-8 text-center text-sm text-[var(--muted)]">
            No automation steps to visualize.
          </div>
        )}
      </div>
  )
}

// ---------------------------------------------------------------------------
// Live canvas — real-time SSE streaming
// ---------------------------------------------------------------------------

function LiveCanvas({ graph, workflowRunId }: { graph: AutomationGraph; workflowRunId: string }) {
  const { snapshot, isConnected, error } = useRunStatus({ workflowRunId, graph })

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs">
        <span className={`flex items-center gap-1.5 ${isConnected ? 'text-green-500' : 'text-[var(--muted)]'}`}>
          <span className={`size-1.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-[var(--muted)]'}`} />
          {isConnected ? 'Connected' : 'Disconnected'}
        </span>
        {snapshot && (
          <span className="text-[var(--muted)]">
            Run status: <span className="font-medium text-[var(--foreground)]">{snapshot.runStatus}</span>
          </span>
        )}
        {error && <span className="text-red-500">{error}</span>}
      </div>

      <AutomationGraphCanvas
        graph={graph}
        readOnly
        nodeStatuses={snapshot?.nodeStatuses}
        nodeErrors={snapshot?.nodeErrors}
        nodeAttempts={snapshot?.nodeAttempts}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Replay canvas — scrubber for historical runs
// ---------------------------------------------------------------------------

function ReplayCanvas({ graph, workflowRunId }: { graph: AutomationGraph; workflowRunId: string }) {
  const { events, snapshot, currentIndex, setCurrentIndex, isLoading, error } = useReplayStatus({
    workflowRunId,
    graph,
  })

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)]">
        <p className="text-sm text-[var(--muted)]">Loading run events…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-96 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)]">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)]">
        <p className="text-sm text-[var(--muted)]">No events found for this run.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <AutomationGraphCanvas
        graph={graph}
        readOnly
        nodeStatuses={snapshot?.nodeStatuses}
        nodeErrors={snapshot?.nodeErrors}
        nodeAttempts={snapshot?.nodeAttempts}
      />

      {/* Scrubber */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-[var(--muted)]">
          <span>Step {currentIndex} of {events.length}</span>
          {snapshot && <span>Run: {snapshot.runStatus}</span>}
        </div>
        <input
          type="range"
          min={0}
          max={events.length}
          value={currentIndex}
          onChange={(e) => setCurrentIndex(Number(e.target.value))}
          className="w-full accent-[var(--foreground)]"
        />
        {/* Event timeline */}
        <div className="flex flex-wrap gap-1">
          {events.map((event, i) => (
            <button
              key={event.eventId}
              type="button"
              onClick={() => setCurrentIndex(i + 1)}
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                i < currentIndex
                  ? 'bg-[var(--surface-muted)] text-[var(--foreground)]'
                  : 'bg-[var(--surface-subtle)] text-[var(--muted)] hover:bg-[var(--border)]'
              }`}
              title={`${event.eventType}${event.stepName ? `: ${event.stepName}` : ''}`}
            >
              {event.eventType.replace(/^(step_|run_)/, '')}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
