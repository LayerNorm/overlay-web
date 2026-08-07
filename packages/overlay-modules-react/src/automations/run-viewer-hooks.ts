'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import type {
  AutomationGraph,
  AutomationRunEvent,
  AutomationRunStatusSnapshot,
  AutomationNodeRunStatus,
} from '@overlay/app-core'
import {
  initialRunStatus,
  applyEvent,
} from '@overlay/app-core/automations/run-status'

// ---------------------------------------------------------------------------
// useRunStatus — subscribes to the SSE events endpoint and returns a live
// status snapshot that maps workflow step events to per-node statuses.
// ---------------------------------------------------------------------------

export interface UseRunStatusOptions {
  workflowRunId: string | null | undefined
  graph: AutomationGraph | null | undefined
  enabled?: boolean
  /** Injected fetch implementation so the presentational module does not call global fetch directly. */
  fetchImpl?: typeof fetch
}

export interface UseRunStatusResult {
  snapshot: AutomationRunStatusSnapshot | null
  isConnected: boolean
  error: string | null
  events: AutomationRunEvent[]
  disconnect: () => void
}

export function useRunStatus({
  workflowRunId,
  graph,
  enabled = true,
  fetchImpl = fetch,
}: UseRunStatusOptions): UseRunStatusResult {
  const [snapshot, setSnapshot] = useState<AutomationRunStatusSnapshot | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<AutomationRunEvent[]>([])
  const eventSourceRef = useRef<EventSource | null>(null)
  const graphRef = useRef(graph)
  const snapshotRef = useRef<AutomationRunStatusSnapshot | null>(null)

  useEffect(() => {
    graphRef.current = graph
  }, [graph])

  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setIsConnected(false)
  }, [])

  useEffect(() => {
    if (!enabled || !workflowRunId || !graph) {
      disconnect()
      setSnapshot(null)
      setEvents([])
      setError(null)
      return
    }

    const initial = initialRunStatus(graph, workflowRunId)
    setSnapshot(initial)
    snapshotRef.current = initial
    setEvents([])
    setError(null)

    const url = `/api/v1/automations/${encodeURIComponent(workflowRunId)}/events`
    const eventSource = new EventSource(url)
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      setIsConnected(true)
      setError(null)
    }

    eventSource.onmessage = (message) => {
      try {
        const data = JSON.parse(message.data) as
          | { type: 'connected'; workflowRunId: string }
          | { type: 'event'; event: AutomationRunEvent }
          | { type: 'terminal'; runStatus: string }
          | { type: 'error'; error: string }

        if (data.type === 'connected') return

        if (data.type === 'error') {
          setError(data.error)
          return
        }

        if (data.type === 'terminal') {
          setIsConnected(false)
          eventSource.close()
          eventSourceRef.current = null
          return
        }

        if (data.type === 'event') {
          const currentGraph = graphRef.current
          const currentSnapshot = snapshotRef.current
          if (!currentGraph || !currentSnapshot) return

          const nextSnapshot = applyEvent(currentSnapshot, currentGraph, data.event)
          snapshotRef.current = nextSnapshot
          setSnapshot(nextSnapshot)
          setEvents((prev) => [...prev, data.event])
        }
      } catch {
        // Ignore malformed SSE data
      }
    }

    eventSource.onerror = () => {
      setIsConnected(false)
    }

    return () => {
      eventSource.close()
      eventSourceRef.current = null
      setIsConnected(false)
    }
  }, [workflowRunId, graph, enabled, disconnect])

  return { snapshot, isConnected, error, events, disconnect }
}

// ---------------------------------------------------------------------------
// useReplayStatus — loads all events for a completed run and provides
// a scrubber interface to step through them.
// ---------------------------------------------------------------------------

export interface UseReplayStatusOptions {
  workflowRunId: string | null | undefined
  graph: AutomationGraph | null | undefined
  /** Injected fetch implementation so the presentational module does not call global fetch directly. */
  fetchImpl?: typeof fetch
}

export interface UseReplayStatusResult {
  events: AutomationRunEvent[]
  snapshot: AutomationRunStatusSnapshot | null
  currentIndex: number
  setCurrentIndex: (index: number) => void
  isLoading: boolean
  error: string | null
}

export function useReplayStatus({
  workflowRunId,
  graph,
  fetchImpl = fetch,
}: UseReplayStatusOptions): UseReplayStatusResult {
  const [events, setEvents] = useState<AutomationRunEvent[]>([])
  const [currentIndex, setCurrentIndexState] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const graphRef = useRef(graph)

  useEffect(() => {
    graphRef.current = graph
  }, [graph])

  useEffect(() => {
    if (!workflowRunId || !graph) {
      setEvents([])
      setCurrentIndexState(0)
      setError(null)
      return
    }

    setIsLoading(true)
    setError(null)

    async function loadEvents() {
      try {
        const runId = workflowRunId as string
        const url = `/api/v1/automations/${encodeURIComponent(runId)}/events`
        const response = await fetchImpl(url)
        if (!response.ok || !response.body) {
          throw new Error(`Failed to load events: ${response.status}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        const collected: AutomationRunEvent[] = []

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6)) as
                  | { type: 'connected' }
                  | { type: 'event'; event: AutomationRunEvent }
                  | { type: 'terminal' }
                  | { type: 'error'; error: string }

                if (data.type === 'event') {
                  collected.push(data.event)
                } else if (data.type === 'terminal') {
                  break
                } else if (data.type === 'error') {
                  throw new Error(data.error)
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        }

        setEvents(collected)
        setCurrentIndexState(collected.length)
        setIsLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load events')
        setIsLoading(false)
      }
    }

    void loadEvents()
  }, [workflowRunId, graph])

  const snapshot = useMemo(() => {
    if (!graph || !workflowRunId || events.length === 0) return null
    const sliced = events.slice(0, currentIndex)
    let snap = initialRunStatus(graph, workflowRunId)
    for (const event of sliced) {
      snap = applyEvent(snap, graph, event)
    }
    return snap
  }, [graph, workflowRunId, events, currentIndex])

  const setCurrentIndex = useCallback((index: number) => {
    setCurrentIndexState(Math.max(0, Math.min(index, events.length)))
  }, [events.length])

  return {
    events,
    snapshot,
    currentIndex,
    setCurrentIndex,
    isLoading,
    error,
  }
}

export type { AutomationNodeRunStatus }
