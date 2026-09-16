import 'server-only'

/**
 * Projects a harness turn's UI-message chunks into the durable reply row.
 *
 * `@ai-sdk/workflow-harness` runners write `toUIMessageStream()` chunks into a
 * `WritableStream`; this is the stream they write to. It accumulates the
 * transcript (text + parts) in the same persisted shape the hosted agent path
 * produces and forwards to an `AgentMessageStream`-compatible sink, so a
 * managed harness turn streams live into the row like any other agent reply.
 *
 * The accumulated state is returned via `snapshot()` so the caller — a durable
 * step — can carry it across slice boundaries. Each slice constructs a fresh
 * writable seeded with the prior slice's snapshot.
 */

export type HarnessTranscriptSink = {
  pushText(delta: string): void
  pushParts(parts: Array<Record<string, unknown>>): void
}

export type HarnessTranscriptSnapshot = {
  content: string
  parts: Array<Record<string, unknown>>
}

/**
 * Reasoning moves at token pace like text does, but parts writes are
 * step-boundary priced — reasoning updates are throttled to this interval and
 * always flushed at part boundaries (tool calls, step ends).
 */
const HARNESS_PARTS_PUSH_INTERVAL_MS = 750

function stringField(chunk: Record<string, unknown>, key: string): string | undefined {
  const value = chunk[key]
  return typeof value === 'string' ? value : undefined
}

export function createHarnessTranscriptWritable(args: {
  initial?: HarnessTranscriptSnapshot
  now?: () => number
  sink: HarnessTranscriptSink
}) {
  const now = args.now ?? Date.now
  let content = args.initial?.content ?? ''
  const parts: Array<Record<string, unknown>> = [...(args.initial?.parts ?? [])]
  let lastPartsPushAt = Number.NEGATIVE_INFINITY

  const snapshot = () => parts.map((part) => ({ ...part }))
  const pushParts = () => {
    lastPartsPushAt = now()
    args.sink.pushParts(snapshot())
  }

  const toolIndex = (toolCallId: string) => parts.findIndex((part) => {
    if (part.type !== 'tool-invocation' || typeof part.toolInvocation !== 'object' || !part.toolInvocation) return false
    return (part.toolInvocation as Record<string, unknown>).toolCallId === toolCallId
  })
  const patchTool = (toolCallId: string, patch: Record<string, unknown>) => {
    const index = toolIndex(toolCallId)
    if (index < 0) return
    const invocation = parts[index]!.toolInvocation as Record<string, unknown>
    parts[index] = { ...parts[index]!, toolInvocation: { ...invocation, ...patch } }
    pushParts()
  }
  const appendReasoning = (delta: string) => {
    const index = parts.findIndex((part) => part.type === 'reasoning')
    const current = index >= 0 ? parts[index]! : { type: 'reasoning', state: 'streaming', text: '' }
    const next = {
      ...current,
      state: 'streaming',
      text: `${typeof current.text === 'string' ? current.text : ''}${delta}`,
    }
    if (index >= 0) parts[index] = next
    else parts.push(next)
    if (now() - lastPartsPushAt >= HARNESS_PARTS_PUSH_INTERVAL_MS) pushParts()
  }
  const closeReasoning = () => {
    const index = parts.findIndex((part) => part.type === 'reasoning' && part.state === 'streaming')
    if (index < 0) return
    parts[index] = { ...parts[index]!, state: 'done' }
    pushParts()
  }

  const write = (chunk: Record<string, unknown>) => {
    switch (chunk.type) {
      case 'text-delta': {
        // AI SDK emits `delta`; older surfaces emit `text`.
        const delta = stringField(chunk, 'delta') ?? stringField(chunk, 'text') ?? ''
        if (!delta) return
        content += delta
        args.sink.pushText(delta)
        return
      }
      case 'reasoning-delta': {
        const delta = stringField(chunk, 'delta') ?? stringField(chunk, 'text') ?? ''
        if (delta) appendReasoning(delta)
        return
      }
      case 'reasoning-end':
      case 'finish-step': {
        closeReasoning()
        return
      }
      case 'tool-input-available': {
        const toolCallId = stringField(chunk, 'toolCallId')
        if (!toolCallId) return
        parts.push({
          type: 'tool-invocation',
          toolInvocation: {
            toolCallId,
            toolName: stringField(chunk, 'toolName') ?? 'tool',
            state: 'input-available',
            toolInput: chunk.input,
          },
        })
        pushParts()
        return
      }
      case 'tool-output-available': {
        const toolCallId = stringField(chunk, 'toolCallId')
        if (toolCallId) patchTool(toolCallId, { state: 'output-available', toolOutput: chunk.output })
        return
      }
      case 'tool-output-error':
      case 'tool-output-denied': {
        const toolCallId = stringField(chunk, 'toolCallId')
        if (!toolCallId) return
        const message = chunk.type === 'tool-output-denied'
          ? 'Tool execution was denied.'
          : stringField(chunk, 'errorText') ?? 'Tool execution failed.'
        patchTool(toolCallId, { state: 'output-error', toolOutput: { error: message } })
        return
      }
      case 'tool-input-error': {
        const toolCallId = stringField(chunk, 'toolCallId')
        if (toolCallId) patchTool(toolCallId, { state: 'output-error', toolOutput: { error: 'Tool input was invalid.' } })
        return
      }
      case 'finish': {
        closeReasoning()
        return
      }
      default:
        // text-start/end ids, reasoning-start, tool-input-start/delta,
        // start-step, stream-start, resume-session, data-*, source-*, file —
        // the row tracks content and parts, not stream scaffolding.
        return
    }
  }

  const writable = new WritableStream<Record<string, unknown>>({
    write: async (chunk) => {
      write(chunk)
    },
  })

  return {
    writable,
    snapshot: (): HarnessTranscriptSnapshot => ({ content, parts: snapshot() }),
  }
}

export type HarnessTranscriptWritable = ReturnType<typeof createHarnessTranscriptWritable>
