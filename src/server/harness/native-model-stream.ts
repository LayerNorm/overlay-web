import 'server-only'

import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { getOverlayServerContext } from '@/server/bootstrap'
import { createAgentMessageStream, appendAgentTextPart } from '@/server/agents/agent-message-stream'
import { logger } from '@/server/observability/logger'
import { compactAssistantPersistenceForConvex, MAX_PERSISTED_ASSISTANT_CONTENT_CHARS } from '@/shared/chat/persist-assistant-turn'
import { stripTextualToolCalls } from '@/shared/ai/textual-tool-calls'
import { refreshNativeHarnessAccess } from './native-access'
import type { HarnessModelReference } from './secure-model'

function couldBeginTextualToolCall(value: string): boolean {
  const trimmed = value.trimStart()
  if (!trimmed || trimmed.startsWith('```') || '```'.startsWith(trimmed)) return true
  if (trimmed.startsWith('{')) {
    const next = trimmed.slice(1).trimStart()
    return !next || next.startsWith('"')
  }
  if (trimmed.startsWith('[')) {
    const next = trimmed.slice(1).trimStart()
    return !next || next.startsWith('{') || next.startsWith('[')
  }
  return false
}

function createTextualToolCallProjector(
  toolNames: ReadonlySet<string>,
  appendVisibleText: (text: string) => void,
) {
  let partialLine = ''
  let candidateParagraph = ''
  let codeFence = ''
  let insideCodeFence = false

  const flushCandidate = (separator = '') => {
    const visible = stripTextualToolCalls(candidateParagraph, toolNames)
    if (visible) appendVisibleText(visible + separator)
    candidateParagraph = ''
  }

  const projectLine = (line: string) => {
    if (candidateParagraph) {
      if (/^[ \t]*\n$/.test(line)) flushCandidate(line)
      else candidateParagraph += line
      return
    }
    if (insideCodeFence) {
      codeFence += line
      if (/^[ \t]*```/.test(line)) {
        appendVisibleText(stripTextualToolCalls(codeFence, toolNames))
        codeFence = ''
        insideCodeFence = false
      }
      return
    }
    if (/^[ \t]*```/.test(line)) {
      codeFence = line
      insideCodeFence = true
      return
    }
    if (/^[ \t]*[\[{]/.test(line)) {
      candidateParagraph = line
      return
    }
    appendVisibleText(line)
  }

  return {
    push(text: string) {
      const combined = partialLine + text
      partialLine = ''
      let start = 0
      while (start < combined.length) {
        const newline = combined.indexOf('\n', start)
        if (newline < 0) {
          const remainder = combined.slice(start)
          if (candidateParagraph || insideCodeFence || couldBeginTextualToolCall(remainder)) {
            partialLine = remainder
          } else {
            appendVisibleText(remainder)
          }
          return
        }
        projectLine(combined.slice(start, newline + 1))
        start = newline + 1
      }
    },
    flush() {
      if (partialLine) projectLine(partialLine)
      partialLine = ''
      if (candidateParagraph) flushCandidate()
      if (codeFence) appendVisibleText(stripTextualToolCalls(codeFence, toolNames))
      codeFence = ''
      insideCodeFence = false
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
    const markers = ['<tool_call>', '<|python_tag|>']
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
