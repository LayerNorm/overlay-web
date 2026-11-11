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
}

const PREVIEW_PARSE_INTERVAL_MS = 100
const MAX_RENDER_UI_ARGUMENT_CHARS = 300 * 1024

export function createPublicStreamPreviewPublisher(options: {
  writePreview: (preview: Preview) => Promise<unknown>
  isDisabled: () => boolean
  onError: () => void
  onWriteFailure: () => void
}) {
  const toolInputs = new Map<string, ToolInput>()
  const pendingPreviews = new Map<string, Preview>()
  let nextOrder = 0
  let disabled = false
  let parseTimer: ReturnType<typeof setTimeout> | undefined
  let parsePump: Promise<void> | undefined
  let writeTimer: ReturnType<typeof setTimeout> | undefined
  let writePump: Promise<void> | undefined

  const stop = () => {
    disabled = true
    if (parseTimer) clearTimeout(parseTimer)
    if (writeTimer) clearTimeout(writeTimer)
    parseTimer = writeTimer = undefined
    pendingPreviews.clear()
    toolInputs.clear()
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
        try { await options.writePreview(preview) }
        catch (_error) { disabled = true; options.onWriteFailure(); break }
      }
    })().finally(() => { writePump = undefined })
    await writePump
  }

  const queuePreview = async (toolCallId: string, force = false) => {
    const state = toolInputs.get(toolCallId)
    if (!state || disabled || options.isDisabled()) return
    const clearPreview = () => {
      if (!state.hasPreview) return
      state.hasPreview = false
      state.lastPreviewJson = undefined
      pendingPreviews.set(toolCallId, { toolCallId, order: state.order, sequence: state.updateSequence++, textOffset: state.textOffset })
      if (!writeTimer) writeTimer = setTimeout(() => { void flushPreviews() }, 150)
    }
    if (state.raw.length > MAX_RENDER_UI_ARGUMENT_CHARS) {
      clearPreview()
      toolInputs.delete(toolCallId)
      return
    }
    if (!force && state.raw.length === state.lastParsedLength) return
    state.lastParsedLength = state.raw.length
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
        if (state && (force || state.raw.length !== state.lastParsedLength)) await queuePreview(id, force)
      }
    })().finally(() => { parsePump = undefined })
    await parsePump
  }

  const scheduleParsing = () => {
    if (parseTimer || disabled || options.isDisabled()) return
    parseTimer = setTimeout(() => {
      parseTimer = undefined
      void flushParsing().catch((_error) => { stop(); options.onError() })
    }, PREVIEW_PARSE_INTERVAL_MS)
  }

  return {
    start(toolCallId: string, toolName: string, textOffset: number) {
      if (toolName === 'render_ui' && nextOrder < 4) toolInputs.set(toolCallId, {
        raw: '', order: nextOrder++, updateSequence: 0, textOffset, lastParsedLength: 0, hasPreview: false,
      })
    },
    delta(toolCallId: string, value: string) {
      const state = toolInputs.get(toolCallId)
      if (state) { state.raw += value; scheduleParsing() }
    },
    async beforeToolStart() { await flushParsing() },
    async end(toolCallId: string) {
      await flushParsing(true)
      await flushPreviews()
      toolInputs.delete(toolCallId)
    },
    async flushPreviews() { await flushPreviews() },
    async flush() { await flushParsing(true); await flushPreviews() },
    stop,
  }
}
