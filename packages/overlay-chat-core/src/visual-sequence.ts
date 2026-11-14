import {
  normalizeAgentAssistantText,
  redactOpaqueNotebookFileIdsInVisibleText,
  splitRedactedThinkingSegments,
} from './agent-assistant-text'
import {
  GENERATED_UI_TOOL_IDS,
  buildGeneratedUiPart,
  buildStreamingGeneratedUiPart,
  normalizeGeneratedUiPart,
} from './generated-ui'
import { TOOL_UI_DONE_STATES } from './constants'
import type { AssistantVisualBlock, ToolVisualBlock } from './types'
import { getToolName, isReasoningUIPart, isToolUIPart } from './ui-parts'

/** Preserve message `parts` order so tools and text interleave (matches stream / persisted transcript). */
export type TerminalAssistantState = 'completed' | 'error' | 'cancelled' | 'interrupted'

/** Plans and questions have their own UI, so their tool calls aren't work to show. */
function isHarnessControlTool(toolName: string | undefined): boolean {
  return Boolean(toolName?.startsWith('harness_'))
}

function generatedUiFailureState(output: unknown, state: string | undefined): 'output-error' | 'output-denied' | null {
  if (state === 'output-denied') return state
  return state === 'output-error' || (output && typeof output === 'object' && 'success' in output && output.success === false)
    ? 'output-error' : null
}

function generatedUiTerminalCallIds(parts: readonly unknown[]): Set<string> {
  const ids = new Set<string>()
  for (const value of parts) {
    let id: string | undefined
    let toolName: string | undefined
    let state: string | undefined
    let output: unknown
    const legacy = value as { type?: string; toolInvocation?: { toolCallId?: string; toolName?: string; state?: string; toolOutput?: unknown } }
    if (legacy?.type === 'tool-invocation' && legacy.toolInvocation) {
      id = legacy.toolInvocation.toolCallId
      toolName = legacy.toolInvocation.toolName
      state = legacy.toolInvocation.state
      output = legacy.toolInvocation.toolOutput
    } else if (isToolUIPart(value)) {
      const part = value as { toolCallId?: string; state?: string; output?: unknown }
      id = part.toolCallId
      toolName = getToolName(value)
      state = part.state
      output = part.output
    }
    const terminal = state === 'output-available' || state === 'output-error' || state === 'output-denied'
      || Boolean(output && typeof output === 'object' && 'success' in output)
    if (id && toolName && GENERATED_UI_TOOL_IDS.has(toolName) && terminal) ids.add(id)
  }
  return ids
}

function isJsonRenderInput(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && ('spec' in value || 'specStream' in value || (value as { kind?: unknown }).kind === 'json_render'))
}

export function buildAssistantVisualSequence(
  parts: unknown[] | undefined,
  options: { terminalState?: TerminalAssistantState } = {},
): AssistantVisualBlock[] {
  if (!parts?.length) return []
  const remoteRunOutcome = getRemoteRunOutcome(parts)
  const terminalCallIds = generatedUiTerminalCallIds(parts)
  const finalDataIds = new Set(parts.flatMap(part => {
    const generated = normalizeGeneratedUiPart(part)
    return generated?.data.kind === 'json_render' && generated.data.streaming !== true ? [generated.id] : []
  }))
  const terminalPreviewBlocked = options.terminalState === 'error' || options.terminalState === 'cancelled' || options.terminalState === 'interrupted'
  const seenGeneratedUiIds = new Set<string>()
  const out: AssistantVisualBlock[] = []
  const appendGeneratedUi = (part: ReturnType<typeof buildGeneratedUiPart>) => {
    if (!part || seenGeneratedUiIds.has(part.id)) return
    seenGeneratedUiIds.add(part.id)
    out.push({ kind: 'generated-ui', part })
  }
  for (const p of parts) {
    const remote = p as { type?: string; data?: Record<string, unknown> }
    const remoteToolName = remote.type === 'data-remote-agent-plan' ? 'remote_plan'
      : remote.type === 'data-remote-agent-diff' ? 'remote_diff'
        : remote.type === 'data-remote-agent-terminal' ? 'remote_terminal' : null
    if (remoteToolName && remote.data) {
      out.push({ kind: 'tool', key: String(remote.data.key ?? `${remoteToolName}-${out.length}`),
        name: remoteToolName, state: remoteToolName === 'remote_terminal'
          && remote.data.status === 'running' && !remoteRunOutcome
          ? 'input-available' : 'output-available', toolInput: remote.data,
        toolOutput: remote.data })
      continue
    }
    const legacy = p as {
      type?: string
      toolInvocation?: {
        toolCallId?: string
        toolName?: string
        state?: string
        toolInput?: Record<string, unknown>
        toolOutput?: unknown
      }
    }
    if (legacy?.type === 'tool-invocation' && legacy.toolInvocation?.toolName) {
      const inv = legacy.toolInvocation
      if (isHarnessControlTool(inv.toolName)) continue
      if (GENERATED_UI_TOOL_IDS.has(inv.toolName!)) {
        const output = inv.toolOutput && typeof inv.toolOutput === 'object'
          ? inv.toolOutput as Record<string, unknown>
          : null
        if (output?.success === true) {
          const part = buildGeneratedUiPart(
            inv.toolCallId || (typeof output.id === 'string' && output.id.trim()) || `generated-ui-${out.length}`,
            output.generatedUi,
          )
          if (part) { appendGeneratedUi(part); continue }
        }
        const callId = inv.toolCallId || `generated-ui-${out.length}`
        const settled = terminalCallIds.has(callId) || finalDataIds.has(callId) || seenGeneratedUiIds.has(callId)
        if (!output && !settled && (inv.state === 'input-streaming' || inv.state === 'input-available')) {
          const part = buildStreamingGeneratedUiPart(
            callId,
            inv.toolInput,
          )
          if (part && !(terminalPreviewBlocked && part.data.kind === 'json_render' && isJsonRenderInput(inv.toolInput))) {
            appendGeneratedUi(part)
            continue
          }
        }
        const failure = generatedUiFailureState(inv.toolOutput, inv.state)
        if (failure) out.push({ kind: 'tool', key: inv.toolCallId || `generated-ui-error-${out.length}`,
          name: inv.toolName!, state: failure, toolInput: inv.toolInput, toolOutput: inv.toolOutput })
        continue
      }
      out.push({
        kind: 'tool',
        key: (inv.toolCallId && inv.toolCallId.trim()) || `legacy-inv-${out.length}`,
        name: inv.toolName as string,
        state: resolveToolState(inv.toolName, inv.state, remoteRunOutcome, options.terminalState),
        toolInput: inv.toolInput,
        toolOutput: inv.toolOutput,
      })
      continue
    }
    if (isToolUIPart(p)) {
      const part = p as {
        toolCallId?: string
        state: string
        input?: Record<string, unknown>
        output?: unknown
      }
      const toolName = getToolName(p)
      if (isHarnessControlTool(toolName)) continue
      if (GENERATED_UI_TOOL_IDS.has(toolName)) {
        const output = part.output && typeof part.output === 'object'
          ? part.output as Record<string, unknown>
          : null
        if (output?.success === true) {
          const generatedPart = buildGeneratedUiPart(
            part.toolCallId || (typeof output.id === 'string' && output.id.trim()) || `generated-ui-${out.length}`,
            output.generatedUi,
          )
          if (generatedPart) { appendGeneratedUi(generatedPart); continue }
        }
        const callId = part.toolCallId || `generated-ui-${out.length}`
        const settled = terminalCallIds.has(callId) || finalDataIds.has(callId) || seenGeneratedUiIds.has(callId)
        if (!output && !settled && (part.state === 'input-streaming' || part.state === 'input-available')) {
          const generatedPart = buildStreamingGeneratedUiPart(
            callId,
            part.input,
          )
          if (generatedPart && !(terminalPreviewBlocked && generatedPart.data.kind === 'json_render' && isJsonRenderInput(part.input))) {
            appendGeneratedUi(generatedPart)
            continue
          }
        }
        const failure = generatedUiFailureState(part.output, part.state)
        if (failure) out.push({ kind: 'tool', key: part.toolCallId || `generated-ui-error-${out.length}`,
          name: toolName, state: failure, toolInput: part.input, toolOutput: part.output })
        continue
      }
      out.push({
        kind: 'tool',
        key: (part.toolCallId && part.toolCallId.trim()) || `sdk-tool-${out.length}`,
        name: toolName,
        state: resolveToolState(toolName, part.state, remoteRunOutcome, options.terminalState),
        toolInput: part.input,
        toolOutput: part.output,
      })
      continue
    }
    if (isReasoningUIPart(p)) {
      const part = p as { type: 'reasoning'; text?: string; state?: string }
      const merged = normalizeAgentAssistantText(part.text?.trim() || '')
      if (!merged) continue
      const prev = out[out.length - 1]
      if (prev?.kind === 'reasoning') {
        prev.text = normalizeAgentAssistantText(`${prev.text}\n\n${merged}`)
      } else {
        out.push({
          kind: 'reasoning',
          key: `reasoning-${out.length}`,
          text: merged,
          state: options.terminalState ? 'done' : part.state,
        })
      }
      continue
    }
    const pt = p as { type?: string; text?: string; url?: string; mediaType?: string }
    const generated = normalizeGeneratedUiPart(p)
    if (generated) {
      const preview = generated.data.kind === 'json_render' && generated.data.streaming === true
      if (preview && (terminalPreviewBlocked || terminalCallIds.has(generated.id) || finalDataIds.has(generated.id))) continue
      appendGeneratedUi(generated)
      continue
    }
    if (pt.type === 'file' && typeof pt.url === 'string' && pt.url) {
      out.push({ kind: 'file', url: pt.url, mediaType: pt.mediaType })
      continue
    }
    if ((pt.type === 'text' || pt.type === 'output-text') && typeof pt.text === 'string') {
      const segList = splitRedactedThinkingSegments(pt.text)
      for (const seg of segList) {
        if (seg.kind === 'text') {
          const merged = normalizeAgentAssistantText(seg.text)
          if (!merged) continue
          const prev = out[out.length - 1]
          if (prev?.kind === 'text') {
            prev.text = normalizeAgentAssistantText(`${prev.text}\n\n${merged}`)
          } else {
            out.push({ kind: 'text', text: merged })
          }
        } else {
          const merged = redactOpaqueNotebookFileIdsInVisibleText(seg.text.trim())
          if (!merged) continue
          const prev = out[out.length - 1]
          if (prev?.kind === 'reasoning') {
            prev.text = redactOpaqueNotebookFileIdsInVisibleText(
              `${prev.text}\n\n${merged}`.trim(),
            )
          } else {
            out.push({
              kind: 'reasoning',
              key: `reasoning-${out.length}`,
              text: merged,
            })
          }
        }
      }
    }
  }

  const remoteActionStates = new Map<string, ToolVisualBlock['state']>()
  for (const block of out) {
    if (block.kind === 'tool' && block.name === 'remote_action') remoteActionStates.set(block.key, block.state)
  }
  for (const block of out) {
    if (block.kind !== 'tool' || block.name !== 'remote_terminal') continue
    const actionState = remoteActionStates.get(block.key)
    if (actionState) block.state = actionState
  }

  for (let i = 0; i < out.length - 1; i++) {
    const rBlk = out[i]
    const tBlk = out[i + 1]
    if (
      rBlk?.kind === 'reasoning' &&
      tBlk?.kind === 'text' &&
      /^'[a-zA-Z]/.test(tBlk.text)
    ) {
      let wordStart = rBlk.text.length
      while (wordStart > 0 && !/\s/.test(rBlk.text[wordStart - 1]!)) wordStart -= 1
      if (wordStart < rBlk.text.length) {
        const word = rBlk.text.slice(wordStart)
        rBlk.text = rBlk.text.slice(0, rBlk.text.length - word.length).trim()
        tBlk.text = word + tBlk.text
      }
    }
  }

  return out
}

type RemoteRunOutcome = 'completed' | 'failed' | 'cancelled' | 'recoverable'

function getRemoteRunOutcome(parts: unknown[]): RemoteRunOutcome | null {
  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index] as { type?: string; data?: { state?: unknown } }
    if (part?.type !== 'data-remote-agent-status') continue
    const state = part.data?.state
    if (state === 'completed' || state === 'failed' || state === 'cancelled' || state === 'recoverable') {
      return state
    }
  }
  return null
}

function resolveToolState(
  toolName: string | undefined,
  state: string | undefined,
  outcome: RemoteRunOutcome | null,
  terminalState?: TerminalAssistantState,
) {
  const current = state ?? 'output-available'
  if (TOOL_UI_DONE_STATES.has(current) || current === 'output-error' || current === 'output-denied') return current
  if (current === 'input-error') return 'output-error'
  if (terminalState) return terminalState === 'completed' ? 'output-available' : 'output-error'
  if (toolName === 'remote_action' && outcome) {
    return outcome === 'completed' ? 'output-available' : 'output-error'
  }
  return current
}
