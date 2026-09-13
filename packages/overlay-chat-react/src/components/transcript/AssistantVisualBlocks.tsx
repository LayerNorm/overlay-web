import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssistantVisualBlock, DraftModalState } from '@overlay/chat-core'
import {
  buildAssistantVisualSegments,
  collectWebSourcesFromBlocks,
  computeToolChainFlags,
  planAssistantWorkCollapse,
} from '@overlay/chat-core'
import type { GeneratedUiData } from '@overlay/chat-core/generated-ui'
import type { SourceCitationMap } from '../../lib/source-citations'
import type {
  AttachmentPreview,
  AttachmentPreviewOpenOptions,
} from '../AttachmentPreviewShell'
import type { GeneratedUiConnectorActions } from '../GeneratedUiCard'
import { WorkedForGroup } from '../exchange'
import {
  AssistantSegmentItem,
  assistantSegmentKey,
  type AssistantSegmentRenderContext,
} from './AssistantSegmentItem'

type AutomationDraftModalState = Extract<DraftModalState, { kind: 'automation' }>

export interface AssistantVisualBlocksProps {
  /** Ordered tools, text, reasoning, and file parts as they appear in the message. */
  blocks: AssistantVisualBlock[]
  /** Stable prefix for React keys — the exchange index in a transcript, the message id elsewhere. */
  blockKeyPrefix: string | number
  /** Remount key for markdown when the source message or model slot changes. */
  markdownKeyPrefix: string
  isStreaming: boolean
  isTextStreaming: boolean
  sourceCitations?: SourceCitationMap
  /** Hide the trailing caret while a separate loading row already signals progress. */
  suppressTypingIndicator?: boolean
  /** Persisted turn duration when the host has one; the live-measured value otherwise. */
  workedDurationMs?: number | null
  onOpenDraft: (state: DraftModalState) => void
  onCreateAutomationDraft: (state: AutomationDraftModalState) => void | Promise<void>
  onOpenAttachmentPreview?: (
    preview: AttachmentPreview,
    options?: AttachmentPreviewOpenOptions,
  ) => void
  generatedUiConnectorActions?: GeneratedUiConnectorActions
  onGeneratedUiChange?: (partId: string, data: GeneratedUiData) => void
}

/**
 * Renders an assistant (or agent) message body: reasoning, tool calls, markdown
 * text, generated files, and generated UI. Shared by the single-model chat
 * transcript and multi-participant rooms so both surfaces read identically.
 *
 * While streaming, every segment renders live in original order. Once the turn
 * settles, all work — tool calls, reasoning, browser sessions — folds behind a
 * single expandable "Worked for N" row at the top so the reply reads as plain
 * text; expanding the row switches the message to the raw timeline with every
 * work segment back at its true position. Deliverables (draft cards, gated
 * callouts, generated files/UI) stay inline in both modes.
 */
export function AssistantVisualBlocks({
  blocks,
  blockKeyPrefix,
  markdownKeyPrefix,
  isStreaming,
  isTextStreaming,
  sourceCitations,
  suppressTypingIndicator = false,
  workedDurationMs,
  onOpenDraft,
  onCreateAutomationDraft,
  onOpenAttachmentPreview,
  generatedUiConnectorActions,
  onGeneratedUiChange,
}: AssistantVisualBlocksProps) {
  const segments = useMemo(() => buildAssistantVisualSegments(blocks), [blocks])
  const toolChainFlags = useMemo(() => computeToolChainFlags(segments), [segments])
  const webSources = useMemo(() => collectWebSourcesFromBlocks(blocks), [blocks])
  const lastTextBlockIndex = useMemo(() => {
    let idx = -1
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i]!.kind === 'text') idx = i
    }
    return idx
  }, [blocks])

  // Turn duration: the persisted createdAt→updatedAt span on the assistant row
  // wins when present; live turns still measure on the streaming→settled edge.
  const streamStartedAtRef = useRef<number | null>(null)
  const [measuredWorkMs, setMeasuredWorkMs] = useState<number | null>(null)
  useEffect(() => {
    if (isStreaming) {
      if (streamStartedAtRef.current == null) streamStartedAtRef.current = Date.now()
      return
    }
    if (streamStartedAtRef.current != null && measuredWorkMs == null) {
      setMeasuredWorkMs(Math.max(0, Date.now() - streamStartedAtRef.current))
    }
  }, [isStreaming, measuredWorkMs])
  const workedMs = workedDurationMs ?? measuredWorkMs

  const collapsePlan = useMemo(
    () => isStreaming
      ? { collapsedIndexes: [] as number[], collapsedToolCallCount: 0 }
      : planAssistantWorkCollapse(segments),
    [segments, isStreaming],
  )
  const collapsedSet = useMemo(
    () => new Set(collapsePlan.collapsedIndexes),
    [collapsePlan],
  )
  const [workExpanded, setWorkExpanded] = useState(false)

  const segmentCtx = useMemo<AssistantSegmentRenderContext>(() => ({
    keyPrefix: blockKeyPrefix,
    markdownKeyPrefix,
    blockCount: blocks.length,
    lastTextBlockIndex,
    isStreaming,
    isTextStreaming,
    sourceCitations,
    webSources,
    suppressTypingIndicator,
    onOpenDraft,
    onCreateAutomationDraft,
    onOpenAttachmentPreview,
    generatedUiConnectorActions,
    onGeneratedUiChange,
  }), [
    blockKeyPrefix, markdownKeyPrefix, blocks.length, lastTextBlockIndex,
    isStreaming, isTextStreaming, sourceCitations, webSources,
    suppressTypingIndicator, onOpenDraft, onCreateAutomationDraft,
    onOpenAttachmentPreview, generatedUiConnectorActions, onGeneratedUiChange,
  ])

  return (
    <>
      {collapsePlan.collapsedIndexes.length > 0 && (
        <WorkedForGroup
          durationMs={workedMs}
          toolCallCount={collapsePlan.collapsedToolCallCount}
          expanded={workExpanded}
          onToggle={() => setWorkExpanded((v) => !v)}
        />
      )}
      {segments.map((seg, segIdx) => {
        if (!workExpanded && collapsedSet.has(segIdx)) return null
        const chain = toolChainFlags[segIdx]!
        return (
          <AssistantSegmentItem
            key={assistantSegmentKey(blockKeyPrefix, seg, isStreaming)}
            seg={seg}
            chainTop={chain.chainTop}
            chainBottom={chain.chainBottom}
            ctx={segmentCtx}
          />
        )
      })}
    </>
  )
}
