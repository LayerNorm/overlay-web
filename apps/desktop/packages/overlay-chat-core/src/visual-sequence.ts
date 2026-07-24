import {
  normalizeAgentAssistantText,
  redactOpaqueNotebookFileIdsInVisibleText,
  splitRedactedThinkingSegments,
} from './agent-assistant-text'
import {
  buildGeneratedUiPart,
  buildStreamingGeneratedUiPart,
  isGeneratedUiPart,
} from './generated-ui'
import type { AssistantVisualBlock } from './types'
import { getToolName, isReasoningUIPart, isToolUIPart } from './ui-parts'

/** Preserve message `parts` order so tools and text interleave (matches stream / persisted transcript). */
export function buildAssistantVisualSequence(parts: unknown[] | undefined): AssistantVisualBlock[] {
  if (!parts?.length) return []
  const out: AssistantVisualBlock[] = []
  for (const p of parts) {
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
      if (inv.toolName === 'present_generated_ui') {
        const output = inv.toolOutput && typeof inv.toolOutput === 'object'
          ? inv.toolOutput as Record<string, unknown>
          : null
        if (output?.success === true) {
          const part = buildGeneratedUiPart(
            inv.toolCallId || (typeof output.id === 'string' && output.id.trim()) || `generated-ui-${out.length}`,
            output.generatedUi,
          )
          if (part) {
            out.push({ kind: 'generated-ui', part })
            continue
          }
        }
        if (!output && (inv.state === 'input-streaming' || inv.state === 'input-available')) {
          const part = buildStreamingGeneratedUiPart(
            inv.toolCallId || `generated-ui-${out.length}`,
            inv.toolInput,
          )
          if (part) {
            out.push({ kind: 'generated-ui', part })
            continue
          }
        }
        continue
      }
      out.push({
        kind: 'tool',
        key: (inv.toolCallId && inv.toolCallId.trim()) || `legacy-inv-${out.length}`,
        name: inv.toolName as string,
        state: inv.state ?? 'output-available',
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
      if (toolName === 'present_generated_ui') {
        const output = part.output && typeof part.output === 'object'
          ? part.output as Record<string, unknown>
          : null
        if (output?.success === true) {
          const generatedPart = buildGeneratedUiPart(
            part.toolCallId || (typeof output.id === 'string' && output.id.trim()) || `generated-ui-${out.length}`,
            output.generatedUi,
          )
          if (generatedPart) {
            out.push({ kind: 'generated-ui', part: generatedPart })
            continue
          }
        }
        if (!output && (part.state === 'input-streaming' || part.state === 'input-available')) {
          const generatedPart = buildStreamingGeneratedUiPart(
            part.toolCallId || `generated-ui-${out.length}`,
            part.input,
          )
          if (generatedPart) {
            out.push({ kind: 'generated-ui', part: generatedPart })
            continue
          }
        }
        continue
      }
      out.push({
        kind: 'tool',
        key: (part.toolCallId && part.toolCallId.trim()) || `sdk-tool-${out.length}`,
        name: toolName,
        state: part.state,
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
          state: part.state,
        })
      }
      continue
    }
    const pt = p as { type?: string; text?: string; url?: string; mediaType?: string }
    if (isGeneratedUiPart(p)) {
      out.push({ kind: 'generated-ui', part: p })
      continue
    }
    if (pt.type === 'file' && typeof pt.url === 'string' && pt.url) {
      out.push({ kind: 'file', url: pt.url, mediaType: pt.mediaType })
      continue
    }
    if (pt.type === 'text' && typeof pt.text === 'string') {
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

  for (let i = 0; i < out.length - 1; i++) {
    const rBlk = out[i]
    const tBlk = out[i + 1]
    if (
      rBlk?.kind === 'reasoning' &&
      tBlk?.kind === 'text' &&
      /^'[a-zA-Z]/.test(tBlk.text)
    ) {
      const lastWordMatch = rBlk.text.match(/(\S+)$/)
      if (lastWordMatch) {
        const word = lastWordMatch[1]!
        rBlk.text = rBlk.text.slice(0, rBlk.text.length - word.length).trim()
        tBlk.text = word + tBlk.text
      }
    }
  }

  return out
}
