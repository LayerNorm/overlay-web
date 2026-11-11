import 'server-only'

import { parsePartialJson } from 'ai'
import { buildStreamingGeneratedUiPart } from '@overlay/chat-core/generated-ui'
import type { PublicStreamPreviewData } from '@/shared/chat/public-stream-projection'

type Preview = {
  toolCallId: string
  order: number
  sequence: number
  textOffset: number
  data?: PublicStreamPreviewData
}

type ToolInput = {
  raw: string
  order: number
  updateSequence: number
  textOffset: number
  lastParsedLength: number
  lastPreviewJson?: string
  hasPreview: boolean
  previewEnabled: boolean
  startedAt: number
  providerDeltaCount: number
  firstDeltaAt?: number
  lastDeltaAt?: number
  parseCount: number
  distinctPreviewCount: number
  writtenPreviewCount: number
  pendingPreviewWriteCount: number
  firstPreviewLatencyMs?: number
  visibleDiagramNodeCountStages: number[]
  summaryEmitted: boolean
}

export type RenderUiInputTerminalStatus = 'completed' | 'cancelled' | 'interrupted'

export type RenderUiInputSummary = {
  toolCallId: string
  status: RenderUiInputTerminalStatus
  providerDeltaCount: number
  firstToLastDeltaMs: number
  parseCount: number
  distinctPreviewCount: number
  writtenPreviewCount: number
  pendingPreviewWriteCount: number
  firstPreviewLatencyMs: number | null
  visibleDiagramNodeCountStages: number[]
}

const PREVIEW_PARSE_INTERVAL_MS = 100
const MAX_RENDER_UI_ARGUMENT_CHARS = 300 * 1024
const MAX_DIAGRAM_NODE_COUNT_STAGES = 8
const MAX_DIAGNOSTIC_COUNT = 1_000_000
const MAX_DIAGNOSTIC_DURATION_MS = 60_000

function visibleDiagramNodeCount(specJson: string): number {
  try {
    const spec = JSON.parse(specJson) as { root?: unknown; elements?: Record<string, unknown> }
    if (typeof spec.root !== 'string' || !spec.elements || typeof spec.elements !== 'object') return 0
    const visited = new Set<string>()
    const pending = [spec.root]
    let nodeCount = 0
    while (pending.length && visited.size < 512) {
      const id = pending.pop()!
      if (visited.has(id)) continue
      visited.add(id)
      const element = spec.elements[id]
      if (!element || typeof element !== 'object' || Array.isArray(element)) continue
      const record = element as { type?: unknown; props?: { nodes?: unknown }; children?: unknown }
      if (record.type === 'Diagram' && Array.isArray(record.props?.nodes)) nodeCount += record.props.nodes.length
      if (Array.isArray(record.children)) {
        for (const child of record.children) if (typeof child === 'string') pending.push(child)
      }
    }
    return nodeCount
  } catch (_error) {
    return 0
  }
}

export function createPublicStreamPreviewPublisher(options: {
  writePreview: (preview: Preview) => Promise<unknown>
  isDisabled: () => boolean
  onError: () => void
  onWriteFailure: () => void
  onCallSummary: (summary: RenderUiInputSummary) => void
  now?: () => number
}) {
  const toolInputs = new Map<string, ToolInput>()
  const pendingPreviews = new Map<string, Preview>()
  const now = options.now ?? (() => performance.now())
  let nextOrder = 0
  let disabled = false
  let parseTimer: ReturnType<typeof setTimeout> | undefined
  let parsePump: Promise<void> | undefined
  let writeTimer: ReturnType<typeof setTimeout> | undefined
  let writePump: Promise<void> | undefined
  let stopPromise: Promise<void> | undefined

  const boundedCount = (value: number) => Math.min(MAX_DIAGNOSTIC_COUNT, value + 1)
  const boundedDuration = (value: number) => Math.min(MAX_DIAGNOSTIC_DURATION_MS, Math.max(0, Math.round(value)))
  const emitSummary = (toolCallId: string, state: ToolInput, status: RenderUiInputTerminalStatus) => {
    if (state.summaryEmitted) return
    state.summaryEmitted = true
    const deltaDuration = state.firstDeltaAt === undefined || state.lastDeltaAt === undefined
      ? 0 : boundedDuration(state.lastDeltaAt - state.firstDeltaAt)
    try {
      options.onCallSummary({
        toolCallId,
        status,
        providerDeltaCount: state.providerDeltaCount,
        firstToLastDeltaMs: deltaDuration,
        parseCount: state.parseCount,
        distinctPreviewCount: state.distinctPreviewCount,
        writtenPreviewCount: state.writtenPreviewCount,
        pendingPreviewWriteCount: state.pendingPreviewWriteCount,
        firstPreviewLatencyMs: state.firstPreviewLatencyMs ?? null,
        visibleDiagramNodeCountStages: [...state.visibleDiagramNodeCountStages],
      })
    } catch (_error) {
      void _error
    }
  }

  const stop = (status: RenderUiInputTerminalStatus = 'interrupted') => {
    if (stopPromise) return stopPromise
    disabled = true
    if (parseTimer) clearTimeout(parseTimer)
    if (writeTimer) clearTimeout(writeTimer)
    parseTimer = writeTimer = undefined
    pendingPreviews.clear()
    stopPromise = Promise.resolve()
    for (const [toolCallId, state] of toolInputs) emitSummary(toolCallId, state, status)
    toolInputs.clear()
    return stopPromise
  }

  const flushPreviews = async () => {
    if (writeTimer) clearTimeout(writeTimer)
    writeTimer = undefined
    if (writePump) { await writePump; if (pendingPreviews.size) await flushPreviews(); return }
    if (disabled || options.isDisabled() || !pendingPreviews.size) return
    const batch = [...pendingPreviews.values()]
    pendingPreviews.clear()
    writePump = (async () => {
      for (const preview of batch) {
        const state = preview.data ? toolInputs.get(preview.toolCallId) : undefined
        if (state) state.pendingPreviewWriteCount = boundedCount(state.pendingPreviewWriteCount)
        try {
          const result = await options.writePreview(preview)
          if (!preview.data) continue
          if (!state) continue
          state.pendingPreviewWriteCount = Math.max(0, state.pendingPreviewWriteCount - 1)
          if (result && typeof result === 'object' && 'accepted' in result && result.accepted === false) continue
          state.writtenPreviewCount = boundedCount(state.writtenPreviewCount)
          if (state.firstPreviewLatencyMs === undefined) {
            state.firstPreviewLatencyMs = boundedDuration(now() - state.startedAt)
          }
        } catch (_error) {
          if (state) state.pendingPreviewWriteCount = Math.max(0, state.pendingPreviewWriteCount - 1)
          disabled = true
          options.onWriteFailure()
          break
        }
      }
    })().finally(() => { writePump = undefined })
    await writePump
  }

  const queuePreview = async (toolCallId: string, force = false) => {
    const state = toolInputs.get(toolCallId)
    if (!state || !state.previewEnabled || disabled || options.isDisabled()) return
    const clearPreview = () => {
      if (!state.hasPreview) return
      state.hasPreview = false
      state.lastPreviewJson = undefined
      pendingPreviews.set(toolCallId, { toolCallId, order: state.order, sequence: state.updateSequence++, textOffset: state.textOffset })
      if (!writeTimer) writeTimer = setTimeout(() => { void flushPreviews() }, 150)
    }
    if (state.raw.length > MAX_RENDER_UI_ARGUMENT_CHARS) {
      clearPreview()
      state.previewEnabled = false
      state.raw = ''
      return
    }
    if (!force && state.raw.length === state.lastParsedLength) return
    state.lastParsedLength = state.raw.length
    state.parseCount = boundedCount(state.parseCount)
    const parsed = await parsePartialJson(state.raw)
    if (disabled || options.isDisabled() || toolInputs.get(toolCallId) !== state) return
    if (parsed.state === 'failed-parse' || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
      clearPreview()
      return
    }
    const input = parsed.value as Record<string, unknown>
    if (input.spec !== undefined && input.specStream !== undefined) { clearPreview(); return }
    const part = buildStreamingGeneratedUiPart(toolCallId, parsed.value)
    if (!part || part.data.kind !== 'json_render' || part.data.streaming !== true) { clearPreview(); return }
    const previewJson = JSON.stringify(part.data)
    if (state.lastPreviewJson === previewJson) return
    state.hasPreview = true
    state.lastPreviewJson = previewJson
    state.distinctPreviewCount = boundedCount(state.distinctPreviewCount)
    const diagramNodeCount = visibleDiagramNodeCount(part.data.specJson)
    if (diagramNodeCount > 0 && state.visibleDiagramNodeCountStages.length < MAX_DIAGRAM_NODE_COUNT_STAGES
      && state.visibleDiagramNodeCountStages.at(-1) !== diagramNodeCount) {
      state.visibleDiagramNodeCountStages.push(diagramNodeCount)
    }
    pendingPreviews.set(toolCallId, {
      toolCallId, order: state.order, sequence: state.updateSequence++, textOffset: state.textOffset,
      data: part.data as PublicStreamPreviewData,
    })
    if (!writeTimer) writeTimer = setTimeout(() => { void flushPreviews() }, 150)
  }

  const flushParsing = async (force = false) => {
    if (parseTimer) clearTimeout(parseTimer)
    parseTimer = undefined
    if (parsePump) await parsePump
    if (disabled || options.isDisabled()) return
    const ids = [...toolInputs.keys()]
    if (!ids.length) return
    parsePump = (async () => {
      for (const id of ids) {
        const state = toolInputs.get(id)
        if (state?.previewEnabled && (force || state.raw.length !== state.lastParsedLength)) await queuePreview(id, force)
      }
    })().finally(() => { parsePump = undefined })
    await parsePump
  }

  const scheduleParsing = () => {
    if (parseTimer || disabled || options.isDisabled()) return
    parseTimer = setTimeout(() => {
      parseTimer = undefined
      void flushParsing().catch((_error) => { void stop('interrupted'); options.onError() })
    }, PREVIEW_PARSE_INTERVAL_MS)
  }

  return {
    start(toolCallId: string, toolName: string, textOffset: number) {
      if (toolName !== 'render_ui') return
      const order = nextOrder++
      toolInputs.set(toolCallId, {
        raw: '', order, updateSequence: 0, textOffset, lastParsedLength: 0, hasPreview: false,
        previewEnabled: order < 4, startedAt: now(), providerDeltaCount: 0, parseCount: 0,
        distinctPreviewCount: 0, writtenPreviewCount: 0, pendingPreviewWriteCount: 0,
        visibleDiagramNodeCountStages: [], summaryEmitted: false,
      })
    },
    delta(toolCallId: string, value: string) {
      const state = toolInputs.get(toolCallId)
      if (!state) return
      const at = now()
      state.providerDeltaCount = boundedCount(state.providerDeltaCount)
      state.firstDeltaAt ??= at
      state.lastDeltaAt = at
      if (state.previewEnabled) { state.raw += value; scheduleParsing() }
    },
    async beforeToolStart() { await flushParsing() },
    async end(toolCallId: string) {
      await flushParsing(true)
      await flushPreviews()
      const state = toolInputs.get(toolCallId)
      if (state) {
        emitSummary(toolCallId, state, 'completed')
        toolInputs.delete(toolCallId)
      }
    },
    async flushPreviews() { await flushPreviews() },
    async flush() { await flushParsing(true); await flushPreviews() },
    stop,
  }
}
