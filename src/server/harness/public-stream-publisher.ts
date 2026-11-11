import 'server-only'

import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { logger } from '@/server/observability/logger'
import { TEXTUAL_TOOL_CALL_MARKERS, stripTextualToolCalls } from '@/shared/ai/textual-tool-calls'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import { createPublicStreamPreviewPublisher, type RenderUiInputTerminalStatus } from './public-stream-preview-publisher'
import type { HarnessModelReference } from './secure-model'

const MAX_CLASSIFIER_CHARS = 16 * 1024
const MAX_PENDING_BYTES = 64 * 1024
const MAX_BATCH_BYTES = 8 * 1024
const FLUSH_INTERVAL_MS = 75

export class PublicTextProjector {
  private partialLine = ''
  private candidate = ''
  private candidateOverflow = false
  private fenceHeader = ''
  private insideFence = false
  private markerCarry = ''
  private suppressionCarry = ''
  private suppressionEnd = ''
  private suppressRest = false

  constructor(private readonly toolNames: ReadonlySet<string>) {}

  private classify(value: string): string[] {
    const visible = stripTextualToolCalls(value, this.toolNames)
    return visible ? [visible] : []
  }

  private isKnownToolCandidate(value: string): boolean {
    const names = [...this.toolNames].map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    return Boolean(names && new RegExp(`["'](?:name|tool)["']\\s*:\\s*["'](?:${names})["']`).test(value))
  }

  private line(value: string): string[] {
    if (this.candidate) {
      if (this.insideFence && /^[ \t]*```/.test(value)) {
        const complete = this.candidate + value
        this.candidate = ''
        this.insideFence = false
        this.fenceHeader = ''
        return this.isKnownToolCandidate(complete) ? [] : [complete]
      }
      this.candidate += value
      if (this.candidate.length > MAX_CLASSIFIER_CHARS) {
        this.candidate = ''
        this.candidateOverflow = true
      }
      if (!this.insideFence && /^[ \t]*\n$/.test(value)) {
        const result = this.candidateOverflow ? [] : this.classify(this.candidate)
        this.candidate = ''
        this.candidateOverflow = false
        return result
      }
      return []
    }
    if (this.candidateOverflow) {
      if (this.insideFence && /^[ \t]*```/.test(value)) {
        this.candidateOverflow = false
        this.insideFence = false
        this.fenceHeader = ''
        return []
      }
      if (!this.insideFence && /^[ \t]*\n$/.test(value)) this.candidateOverflow = false
      return []
    }
    if (this.insideFence) {
      if (/^[ \t]*```/.test(value)) {
        this.insideFence = false
        const result = this.fenceHeader ? [this.fenceHeader + value] : [value]
        this.fenceHeader = ''
        return result
      }
      if (this.fenceHeader) {
        if (/^[ \t]*[\[{]/.test(value)) {
          this.candidate = this.fenceHeader + value
          this.fenceHeader = ''
          return []
        }
        const header = this.fenceHeader
        this.fenceHeader = ''
        return [header, value]
      }
      if (/^[ \t]*[\[{]/.test(value)) {
        this.candidate = value
        return []
      }
      return [value]
    }
    if (/^[ \t]*```/.test(value)) {
      this.fenceHeader = value
      this.insideFence = true
      return []
    }
    if (/^[ \t]*[\[{]/.test(value)) {
      this.candidate = value
      return []
    }
    return [value]
  }

  private visible(value: string, final = false): string[] {
    const output: string[] = []
    const process = (chunk: string) => {
      this.partialLine += chunk
      let start = 0
      while (true) {
        const newline = this.partialLine.indexOf('\n', start)
        if (newline < 0) break
        output.push(...this.line(this.partialLine.slice(start, newline + 1)))
        start = newline + 1
      }
      this.partialLine = this.partialLine.slice(start)
      if (this.partialLine && this.insideFence && this.fenceHeader && !this.candidate && !this.candidateOverflow
        && !/^[ \t]*[`{\[]/.test(this.partialLine)) {
        output.push(this.fenceHeader, this.partialLine)
        this.fenceHeader = ''
        this.partialLine = ''
      } else if (this.partialLine && this.insideFence && !this.fenceHeader && !this.candidate && !this.candidateOverflow
        && !/^[ \t]*[`{\[]/.test(this.partialLine)) {
        output.push(this.partialLine)
        this.partialLine = ''
      } else if (this.partialLine && !this.candidate && !this.candidateOverflow
        && !/^[ \t]*[\[{`]/.test(this.partialLine)) {
        output.push(this.partialLine)
        this.partialLine = ''
      }
      if (this.partialLine.length + this.candidate.length + this.fenceHeader.length
        + this.markerCarry.length + this.suppressionCarry.length > MAX_CLASSIFIER_CHARS) {
        this.partialLine = ''
        this.candidate = ''
        this.fenceHeader = ''
        this.candidateOverflow = true
      }
    }
    for (let offset = 0; offset < value.length;) {
      let end = Math.min(value.length, offset + 4_096)
      const last = value.charCodeAt(end - 1)
      if (end < value.length && last >= 0xD800 && last <= 0xDBFF) end--
      process(value.slice(offset, end))
      offset = end
    }
    if (final && this.partialLine) {
      output.push(...this.line(this.partialLine))
      this.partialLine = ''
    }
    return output
  }

  push(text: string): string[] {
    if (!text || this.suppressRest) return []
    const combined = this.suppressionCarry + this.markerCarry + text
    this.suppressionCarry = ''
    this.markerCarry = ''
    if (this.suppressionEnd) {
      const endMarker = this.suppressionEnd
      const end = combined.indexOf(endMarker)
      if (end < 0) {
        let held = 0
        for (let length = Math.min(endMarker.length - 1, combined.length); length > held; length--) {
          if (endMarker.startsWith(combined.slice(-length))) held = length
        }
        this.suppressionCarry = combined.slice(combined.length - held)
        return []
      }
      this.suppressionEnd = ''
      return this.push(combined.slice(end + endMarker.length))
    }
    const markerIndex = TEXTUAL_TOOL_CALL_MARKERS
      .map(marker => ({ marker, index: combined.indexOf(marker) }))
      .filter(item => item.index >= 0)
      .sort((a, b) => a.index - b.index)[0]
    if (markerIndex) {
      const output = this.visible(combined.slice(0, markerIndex.index))
      const marker = markerIndex.marker
      if (marker.includes('python_tag')) this.suppressRest = true
      else this.suppressionEnd = marker === '<tool_call>' ? '</tool_call>' : ''
      if (!this.suppressionEnd) this.suppressRest = true
      if (this.suppressionEnd) output.push(...this.push(combined.slice(markerIndex.index + marker.length)))
      return output
    }
    let held = 0
    for (const marker of TEXTUAL_TOOL_CALL_MARKERS) {
      for (let length = Math.min(marker.length - 1, combined.length); length > held; length--) {
        if (marker.startsWith(combined.slice(-length))) held = length
      }
    }
    this.markerCarry = combined.slice(combined.length - held)
    return this.visible(combined.slice(0, combined.length - held))
  }

  flush(): string[] {
    const output = this.suppressRest || this.suppressionEnd
      ? [] : this.visible(this.markerCarry, true)
    this.markerCarry = ''
    if (this.candidate && !this.candidateOverflow && !this.insideFence && !this.isKnownToolCandidate(this.candidate)) {
      try {
        JSON.parse(this.candidate)
        output.push(...this.classify(this.candidate))
      } catch (_error) {
        // Incomplete protocol-shaped text is not safe to publish.
      }
    }
    else if (!this.candidateOverflow && this.fenceHeader) output.push(this.fenceHeader)
    this.candidate = ''
    this.fenceHeader = ''
    this.candidateOverflow = false
    return output
  }
}

function utf8Size(value: string) {
  return new TextEncoder().encode(value).byteLength
}

function takePrefix(value: string, maxBytes: number) {
  let prefix = ''
  let bytes = 0
  let offset = 0
  for (const character of value) {
    const size = utf8Size(character)
    if (bytes + size > maxBytes) break
    prefix += character
    bytes += size
    offset += character.length
  }
  return { prefix, rest: value.slice(offset) }
}

export function publishUnifiedHarnessStream(
  reference: HarnessModelReference,
  source: ReadableStream<LanguageModelV4StreamPart>,
  toolNames: ReadonlySet<string>,
  modelDispatchStartedAt = performance.now(),
): ReadableStream<LanguageModelV4StreamPart> {
  const authority = reference.personal ?? reference.native
  if (!authority || reference.publicStreamVersion !== 1 || reference.purpose !== 'response') return source
  const access = authority.access
  const writer = new ConvexHarnessRepository()
  const projector = new PublicTextProjector(toolNames)
  const now = () => performance.now()
  const startedAt = modelDispatchStartedAt
  let firstProviderTextAt: number | undefined
  let pending = ''
  let pendingBytes = 0
  let peakPendingBytes = 0
  let sequence = 0
  let writes = 0
  let failedWrites = 0
  let outputCharacters = 0
  let disabled = false
  let closed = false
  let forced = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let pump: Promise<void> | undefined
  const key = { runId: access.runId, generation: access.executionGeneration ?? 0,
    receiptId: authority.receiptId, modelId: reference.modelId }
  const metric = (event: string, fields: Record<string, unknown> = {}) => {
    try { logger.info('[harness] unified public stream', { event, ...key, ...fields }) } catch (_error) { void _error }
  }
  const clearTimer = () => { if (timer) clearTimeout(timer); timer = undefined }
  const previewPublisher = createPublicStreamPreviewPublisher({
    isDisabled: () => disabled,
    writePreview: preview => writer.appendPublicStream({
      actorUserId: access.actorUserId, runId: access.runId, workflowRunId: access.workflowRunId,
      executionGeneration: access.executionGeneration ?? 0, receiptId: authority.receiptId,
      modelId: reference.modelId, sequence, text: '', preview,
    }),
    onError: () => { disabled = true; pending = ''; pendingBytes = 0; clearTimer(); metric('publisher_error') },
    onWriteFailure: () => metric('preview_write_failed'),
    onCallSummary: summary => metric('render_ui_input_summary', {
      toolCallId: summary.toolCallId,
      status: summary.status,
      providerDeltaCount: summary.providerDeltaCount,
      firstToLastDeltaMs: summary.firstToLastDeltaMs,
      parseCount: summary.parseCount,
      distinctPreviewCount: summary.distinctPreviewCount,
      writtenPreviewCount: summary.writtenPreviewCount,
      pendingPreviewWriteCount: summary.pendingPreviewWriteCount,
      firstPreviewLatencyMs: summary.firstPreviewLatencyMs,
      visibleDiagramNodeCountStages: summary.visibleDiagramNodeCountStages,
    }),
  })
  const stop = (status: RenderUiInputTerminalStatus = 'interrupted') => {
    disabled = true
    pending = ''
    pendingBytes = 0
    clearTimer()
    return previewPublisher.stop(status)
  }

  const requestPump = (force = false): Promise<void> => {
    if (force) forced = true
    if (pump) return pump
    pump = (async () => {
      while (!disabled && pending && (forced || pendingBytes >= MAX_BATCH_BYTES || closed)) {
        const batch = takePrefix(pending, MAX_BATCH_BYTES)
        if (!batch.prefix) break
        pending = batch.rest
        pendingBytes -= utf8Size(batch.prefix)
        let acknowledged = false
        for (let attempt = 0; attempt < 2 && !acknowledged; attempt++) {
          try {
            const result = await writer.appendPublicStream({
              actorUserId: access.actorUserId, runId: access.runId, workflowRunId: access.workflowRunId,
              executionGeneration: access.executionGeneration ?? 0, receiptId: authority.receiptId,
              modelId: reference.modelId, sequence, text: batch.prefix,
            })
            if (!result.accepted) throw new Error('write_rejected')
            acknowledged = true
            sequence++
            writes++
            if (writes === 1) metric('first_publish_ack', { sinceFirstProviderTextMs: firstProviderTextAt === undefined ? null : Math.round(now() - firstProviderTextAt) })
          } catch (_error) {
            failedWrites++
            if (attempt === 1) {
              metric('publish_write_failed', { failures: failedWrites })
              stop()
            }
          }
        }
      }
      if (!pending) forced = false
    })().finally(() => {
      pump = undefined
      if (!disabled && pending && (forced || pendingBytes >= MAX_BATCH_BYTES || closed)) void requestPump()
    })
    return pump
  }

  const append = async (text: string) => {
    outputCharacters += text.length
    let remainder = text
    while (remainder && !disabled) {
      if (pendingBytes >= MAX_PENDING_BYTES) await requestPump(true)
      const next = takePrefix(remainder, MAX_PENDING_BYTES - pendingBytes)
      if (!next.prefix) { await requestPump(true); continue }
      pending += next.prefix
      pendingBytes += utf8Size(next.prefix)
      peakPendingBytes = Math.max(peakPendingBytes, pendingBytes)
      remainder = next.rest
      if (writes === 0 || pendingBytes >= MAX_BATCH_BYTES) void requestPump(true)
      else if (!timer) timer = setTimeout(() => { timer = undefined; void requestPump(true) }, FLUSH_INTERVAL_MS)
    }
  }
  const flush = async () => {
    clearTimer()
    await requestPump(true)
    while (!disabled && (pending || pump)) {
      if (!pump) void requestPump(true)
      const current = pump
      if (current) await current
    }
    await previewPublisher.flushPreviews()
  }

  const transformed = source.pipeThrough(new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
    async transform(part, controller) {
      try {
        if (part.type === 'text-delta') {
          if (firstProviderTextAt === undefined) {
            firstProviderTextAt = now()
            metric('first_provider_text', { sinceModelDispatchMs: Math.round(firstProviderTextAt - startedAt) })
          }
          for (const safeText of projector.push(part.delta)) await append(safeText)
        } else if (part.type === 'tool-input-start') {
          await previewPublisher.beforeToolStart()
          await flush()
          previewPublisher.start(part.id, part.toolName, outputCharacters)
        } else if (part.type === 'tool-input-delta') {
          previewPublisher.delta(part.id, part.delta)
        } else if (part.type === 'tool-input-end') {
          await previewPublisher.end(part.id)
          await flush()
        } else {
          await flush()
        }
      } catch (_error) {
        void stop('interrupted')
        metric('publisher_error')
      }
      controller.enqueue(part)
    },
    async flush() {
      closed = true
      clearTimer()
      try {
        await previewPublisher.flush()
        for (const safeText of projector.flush()) await append(safeText)
        await flush()
      } catch (_error) {
        void stop('interrupted')
        metric('publisher_error')
      }
      metric('stream_finish', {
        outputCharacters, generationDurationMs: firstProviderTextAt === undefined ? 0 : Math.round(now() - firstProviderTextAt),
        publishWrites: writes, failedWrites, peakPendingBytes,
      })
    },
  }))
  const reader = transformed.getReader()
  return new ReadableStream<LanguageModelV4StreamPart>({
    async pull(controller) {
      try {
        const result = await reader.read()
        if (result.done) {
          await stop('completed')
          controller.close()
        } else controller.enqueue(result.value)
      } catch (error) {
        clearTimer()
        try {
          for (const safeText of projector.flush()) await append(safeText)
          await flush()
        } catch (_persistError) {
          await stop('interrupted')
        }
        await stop('interrupted')
        metric('stream_error')
        controller.error(error)
      }
    },
    async cancel(reason) {
      closed = true
      await stop('cancelled')
      await reader.cancel(reason)
    },
  })
}
