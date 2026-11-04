import 'server-only'

import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { getOverlayServerContext } from '@/server/bootstrap'
import { createAgentMessageStream, appendAgentTextPart } from '@/server/agents/agent-message-stream'
import { logger } from '@/server/observability/logger'
import { compactAssistantPersistenceForConvex, MAX_PERSISTED_ASSISTANT_CONTENT_CHARS } from '@/shared/chat/persist-assistant-turn'
import { hasTextualToolCalls, stripTextualToolCalls, TEXTUAL_TOOL_CALL_MARKERS } from '@/shared/ai/textual-tool-calls'
import { stripHarnessBookkeeping } from './public-text'
import { refreshNativeHarnessAccess } from './native-access'
import type { HarnessModelReference } from './secure-model'

function createTextualToolCallProjector(
  toolNames: ReadonlySet<string>,
  appendVisibleText: (text: string) => void,
) {
  let block = ''
  let pendingLine = ''
  let overflowedLine = false
  let overflowedLineWhitespace = true
  let overflowedFenceOpeningLength: number | undefined
  let droppingBlock = false
  let codeFenceLength = 0
  let emittedBlock = false

  const emitBlock = (text: string) => {
    const code = /(?:^|\n)[ \t]*```/.test(text)
    const containsToolCall = hasTextualToolCalls(text, toolNames)
    const visible = code
      ? containsToolCall ? stripTextualToolCalls(text, toolNames) : text.replace(/\n[ \t]*\n+$/, '')
      : stripHarnessBookkeeping(text, toolNames)
    if (!visible) return
    appendVisibleText(`${emittedBlock ? '\n\n' : ''}${visible}`)
    emittedBlock = true
  }

  const resetBlock = () => {
    if (!droppingBlock && block) emitBlock(block)
    block = ''
    droppingBlock = false
  }

  const processLine = (line: string) => {
    if (!droppingBlock) {
      if (block.length + line.length > MAX_PERSISTED_ASSISTANT_CONTENT_CHARS) {
        block = ''
        droppingBlock = true
      } else {
        block += line
      }
    }

    const fence = line.replace(/\r?\n$/, '').match(/^[ \t]*(`{3,})(.*)$/)
    if (fence) {
      if (!codeFenceLength) codeFenceLength = fence[1]!.length
      else if (fence[1]!.length >= codeFenceLength && /^[ \t]*$/.test(fence[2]!)) codeFenceLength = 0
    }
    if (!codeFenceLength && /^[ \t]*\r?\n$/.test(line)) resetBlock()
  }

  return {
    push(text: string) {
      let cursor = 0
      if (overflowedLine) {
        const newline = text.indexOf('\n')
        const skipped = newline < 0 ? text : text.slice(0, newline)
        overflowedLineWhitespace &&= /^[ \t\r]*$/.test(skipped)
        if (newline < 0) return
        if (overflowedFenceOpeningLength && !codeFenceLength) codeFenceLength = overflowedFenceOpeningLength
        if (overflowedLineWhitespace && !codeFenceLength) resetBlock()
        overflowedLine = false
        overflowedLineWhitespace = true
        overflowedFenceOpeningLength = undefined
        cursor = newline + 1
      }

      const combined = pendingLine + text.slice(cursor)
      pendingLine = ''
      let start = 0
      let newline: number
      while ((newline = combined.indexOf('\n', start)) >= 0) {
        processLine(combined.slice(start, newline + 1))
        start = newline + 1
      }
      const remainder = combined.slice(start)
      if (!remainder) return
      if (block.length + remainder.length > MAX_PERSISTED_ASSISTANT_CONTENT_CHARS) {
        block = ''
        droppingBlock = true
        overflowedLine = true
        overflowedLineWhitespace = /^[ \t\r]*$/.test(remainder)
        if (!codeFenceLength) {
          const fenceOpening = remainder.match(/^[ \t]*(`{3,})/)
          overflowedFenceOpeningLength = fenceOpening?.[1]?.length
        }
      } else pendingLine = remainder
    },
    flush() {
      if (overflowedLine) {
        if (overflowedFenceOpeningLength && !codeFenceLength) codeFenceLength = overflowedFenceOpeningLength
        overflowedLine = false
      } else if (pendingLine) {
        processLine(pendingLine)
        pendingLine = ''
      }
      if (codeFenceLength) droppingBlock = true
      if (!droppingBlock && block) emitBlock(block)
      block = ''
      pendingLine = ''
      droppingBlock = false
      codeFenceLength = 0
      overflowedLineWhitespace = true
      overflowedFenceOpeningLength = undefined
    },
  }
}

export async function projectNativeHarnessStream(
  reference: HarnessModelReference,
  source: ReadableStream<LanguageModelV4StreamPart>,
  toolNames: ReadonlySet<string> = new Set(),
): Promise<ReadableStream<LanguageModelV4StreamPart>> {
  const native = reference.native
  if (!native?.streamToDelivery || native.access.runId !== `workspace:${native.access.agentRunId}`) return source
  const access = native.access
  try {
    const store = getOverlayServerContext().appData.repositories.conversationCollaboration
    const identity = { actorUserId: access.actorUserId, conversationId: access.conversationId, workspaceId: access.workspaceId }
    const [message] = await store.listMessages({ ...identity, messageId: access.assistantMessageId, limit: 1 })
    if (!message || message._id !== access.assistantMessageId || message.turnId !== access.turnId
      || message.authorKind !== 'agent' || message.authorPrincipalId !== access.agentPrincipalId
      || message.status !== 'generating') return source
    let parts = (message.parts ?? []).filter(part => part.type !== 'reasoning').map(part => ({ ...part }))
    let remaining = Math.max(0, MAX_PERSISTED_ASSISTANT_CONTENT_CHARS - message.content.length)
    const stream = createAgentMessageStream({
      ...identity, authorPrincipalId: access.agentPrincipalId, turnId: access.turnId,
      clientNonce: `harness:${access.runId}`, existingMessageId: access.assistantMessageId, modelId: reference.modelId,
      store: {
        startAgentMessage: async () => access.assistantMessageId,
        finalizeAgentMessage: args => store.finalizeAgentMessage(args),
        failAgentMessage: args => store.failAgentMessage(args),
        appendAgentMessageDelta: async args => {
          await refreshNativeHarnessAccess(access, { modelId: reference.modelId, memoryEnabled: native.memoryEnabled,
            sharedRoom: native.sharedRoom, requestFingerprint: native.requestFingerprint })
          await store.appendAgentMessageDelta({ ...args, ...(args.parts ? {
            parts: compactAssistantPersistenceForConvex({ content: '', parts: args.parts }).parts,
          } : {}) })
        },
      },
    })
    let firstText = true
    let protocolSeen = false
    let pendingMarkerPrefix = ''
    const markers = TEXTUAL_TOOL_CALL_MARKERS
    const appendVisibleText = (text: string) => {
      if (!text || remaining <= 0) return
      const visible = `${firstText && message.content.trim() ? '\n\n' : ''}${text}`.slice(0, remaining)
      if (!visible) return
      firstText = false
      remaining -= visible.length
      appendAgentTextPart(parts, visible)
      parts = compactAssistantPersistenceForConvex({ content: '', parts }).parts
      stream.pushText(visible, parts)
    }
    const textualToolCallProjector = createTextualToolCallProjector(toolNames, appendVisibleText)
    const projectTextDelta = (delta: string) => {
      if (protocolSeen || remaining <= 0) return
      const combined = `${pendingMarkerPrefix}${delta}`
      const markerIndex = markers
        .map(marker => combined.indexOf(marker))
        .filter(index => index >= 0)
        .sort((a, b) => a - b)[0]
      if (markerIndex !== undefined) {
        textualToolCallProjector.push(combined.slice(0, markerIndex))
        pendingMarkerPrefix = ''
        protocolSeen = true
        return
      }
      let heldLength = 0
      for (const marker of markers) {
        for (let length = Math.min(marker.length - 1, combined.length); length > heldLength; length--) {
          if (marker.startsWith(combined.slice(-length))) heldLength = length
        }
      }
      pendingMarkerPrefix = combined.slice(combined.length - heldLength)
      textualToolCallProjector.push(combined.slice(0, combined.length - heldLength))
    }
    const flushPendingText = () => {
      if (!protocolSeen) textualToolCallProjector.push(pendingMarkerPrefix)
      pendingMarkerPrefix = ''
      textualToolCallProjector.flush()
    }
    return source.pipeThrough(new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
      async transform(part, controller) {
        try {
          if (part.type === 'text-delta') {
            projectTextDelta(part.delta)
          }
          if (part.type === 'text-end' || part.type === 'tool-input-start') flushPendingText()
          if (part.type === 'finish' || part.type === 'error') {
            flushPendingText()
            await stream.flush()
          }
        } catch (_error) {
          logger.warn('[harness] native stream projection write unavailable', { runId: access.runId })
        }
        controller.enqueue(part)
      },
      flush: async () => {
        try {
          flushPendingText()
          await stream.flush()
        } catch (_error) {
          logger.warn('[harness] native stream projection flush unavailable', { runId: access.runId })
        }
      },
    }))
  } catch (_error) {
    // Presentation cannot retry or cancel an already-dispatched inference.
    // The workflow's terminal write still rewrites the authoritative response.
    logger.warn('[harness] native stream projection unavailable', { runId: access.runId })
    return source
  }
}
