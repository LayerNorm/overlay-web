/* eslint-disable @next/next/no-img-element -- shared renderer must stay platform-neutral */
import { lazy, Suspense } from 'react'
import type {
  AssistantVisualSegment,
  DraftModalState,
  ToolVisualBlock,
} from '@overlay/chat-core'
import {
  getDraftFromToolBlock,
  isOverlayGatedToolOutput,
} from '@overlay/chat-core'
import type { GeneratedUiData } from '@overlay/chat-core/generated-ui'
import type { SourceCitationMap } from '../../lib/source-citations'
import type { WebSourceItem } from '../../lib/web-sources'
import { MarkdownMessage } from '../MarkdownMessage'
import type {
  AttachmentPreview,
  AttachmentPreviewOpenOptions,
} from '../AttachmentPreviewShell'
import type { GeneratedUiConnectorActions } from '../GeneratedUiCard'
import {
  BrowserToolBlock,
  DraftSuggestionCard,
  GatedPaidFeatureCallout,
  MemoryToolBlock,
  ReasoningBlock,
  SingleToolCallRow,
  ToolCallsCollapsedGroup,
  WebSearchToolBlock,
} from '../exchange'

const GeneratedUiCard = lazy(() =>
  import('../GeneratedUiCard').then((mod) => ({ default: mod.GeneratedUiCard })),
)

type AutomationDraftModalState = Extract<DraftModalState, { kind: 'automation' }>

/** Everything a segment needs that does not vary per segment. */
export interface AssistantSegmentRenderContext {
  /** Stable prefix for React keys — exchange index in a transcript, message id elsewhere. */
  keyPrefix: string | number
  /** Remount key for markdown when the source message or model slot changes. */
  markdownKeyPrefix: string
  /** Total visual blocks in the message — reasoning activity checks the tail. */
  blockCount: number
  /** Block index of the final text block, or -1 when the message has none. */
  lastTextBlockIndex: number
  isStreaming: boolean
  isTextStreaming: boolean
  sourceCitations?: SourceCitationMap
  webSources?: WebSourceItem[]
  suppressTypingIndicator?: boolean
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
 * One visual segment of an assistant message. Single source for the
 * segment-switch so the transcript, room items, and the expanded "Worked"
 * group all render a given segment identically.
 */
export function AssistantSegmentItem({
  seg,
  chainTop,
  chainBottom,
  ctx,
}: {
  seg: AssistantVisualSegment
  chainTop: boolean
  chainBottom: boolean
  ctx: AssistantSegmentRenderContext
}) {
  if (seg.kind === 'reasoning') {
    // Actively streaming = still emitting reasoning deltas (or message-level stream and
    // this part has not been explicitly marked `done`). Everything else collapses.
    const active =
      (ctx.isStreaming && seg.block.state === 'streaming') ||
      (ctx.isStreaming && seg.block.state !== 'done' && seg.originIndex === ctx.blockCount - 1)
    return (
      <ReasoningBlock
        text={seg.block.text}
        streaming={active}
        connectTop={chainTop}
        connectBottom={chainBottom}
      />
    )
  }
  if (seg.kind === 'browser') {
    return (
      <BrowserToolBlock
        block={seg.block}
        connectTop={chainTop}
        connectBottom={chainBottom}
      />
    )
  }
  if (seg.kind === 'tools') {
    const onlyTools = seg.items.every((it): it is ToolVisualBlock => it.kind === 'tool')
    if (onlyTools && seg.items.length === 1) {
      const t = seg.items[0] as ToolVisualBlock
      // Only promote a draft to its card once the turn is finished. Mid-stream
      // this segment is a lone tool block, so the card mounts, then unmounts the
      // moment the next tool call regroups the segment, then remounts at the end
      // — reading as a card that flickers in and collapses. While streaming, let
      // it render as an ordinary tool block instead.
      const draft = ctx.isStreaming ? null : getDraftFromToolBlock(t)
      if (draft) {
        const isAutomationDraft = draft.kind === 'automation'
        return (
          <DraftSuggestionCard
            title={draft.draft.name}
            description={draft.draft.description}
            badge={isAutomationDraft ? 'Automation Draft' : 'Skill Draft'}
            reason={draft.draft.reason}
            primaryLabel="Review draft"
            secondaryLabel={isAutomationDraft ? 'Create automation' : 'Save skill'}
            onPrimary={() => ctx.onOpenDraft(draft)}
            onSecondary={() => {
              if (draft.kind === 'automation') {
                void ctx.onCreateAutomationDraft(draft)
              } else {
                ctx.onOpenDraft(draft)
              }
            }}
          />
        )
      }
      if (isOverlayGatedToolOutput(t.toolOutput)) {
        return (
          <GatedPaidFeatureCallout
            block={t}
            connectTop={chainTop}
            connectBottom={chainBottom}
          />
        )
      }
      if (t.name === 'perplexity_search' || t.name === 'parallel_search') {
        return (
          <WebSearchToolBlock
            block={t}
            connectTop={chainTop}
            connectBottom={chainBottom}
          />
        )
      }
      if (t.name === 'save_memory' || t.name === 'save_memory_batch' || t.name === 'update_memory') {
        return (
          <MemoryToolBlock
            block={t}
            connectTop={chainTop}
            connectBottom={chainBottom}
          />
        )
      }
      return (
        <SingleToolCallRow
          block={t}
          connectTop={chainTop}
          connectBottom={chainBottom}
        />
      )
    }
    return (
      <ToolCallsCollapsedGroup
        items={seg.items}
        connectTop={chainTop}
        connectBottom={chainBottom}
      />
    )
  }
  if (seg.kind === 'file') {
    const block = seg.block
    const isImg = (block.mediaType?.startsWith('image/') ?? true)
    const isVideo = block.mediaType?.startsWith('video/') ?? false
    if (!isImg && !isVideo) return null
    const previewName = isImg ? 'generated-image.png' : 'generated-video.mp4'
    return (
      <div className="w-full px-1 py-1">
        {isImg ? (
          <button
            type="button"
            onClick={() => ctx.onOpenAttachmentPreview?.({ name: previewName, content: block.url, url: block.url })}
            className="rounded-xl outline-none transition-transform hover:scale-[1.005] focus-visible:ring-2 focus-visible:ring-[var(--foreground)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
            title="Open attachment"
          >
            <img
              src={block.url}
              alt="Generated"
              className="max-h-[320px] max-w-full rounded-xl border border-[var(--border)] object-contain"
            />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => ctx.onOpenAttachmentPreview?.({ name: previewName, content: block.url, url: block.url })}
            className="rounded-xl outline-none transition-transform hover:scale-[1.005] focus-visible:ring-2 focus-visible:ring-[var(--foreground)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
            title="Open attachment"
          >
            <video
              src={block.url}
              controls
              preload="metadata"
              playsInline
              className="max-h-[320px] max-w-full rounded-xl border border-[var(--border)] object-contain"
            />
          </button>
        )}
      </div>
    )
  }
  if (seg.kind === 'generated-ui') {
    return (
      <Suspense
        fallback={<div className="ui-skeleton-line min-h-24 w-full rounded-lg" aria-busy="true" />}
      >
        <GeneratedUiCard
          part={seg.block.part}
          connectorActions={ctx.generatedUiConnectorActions}
          onDataChange={ctx.onGeneratedUiChange}
        />
      </Suspense>
    )
  }
  const block = seg.block
  const isLastText = seg.originIndex === ctx.lastTextBlockIndex
  return (
    <div
      className="w-full px-1 py-1 text-sm leading-relaxed text-[var(--foreground)]"
    >
      <MarkdownMessage
        key={`md-${ctx.markdownKeyPrefix}-${seg.originIndex}`}
        text={block.text}
        isStreaming={ctx.isTextStreaming && isLastText}
        sourceCitations={isLastText ? ctx.sourceCitations : undefined}
        webSources={isLastText && ctx.webSources && ctx.webSources.length > 0 ? ctx.webSources : undefined}
        suppressTypingIndicator={ctx.suppressTypingIndicator}
        onOpenAttachmentPreview={ctx.onOpenAttachmentPreview}
      />
    </div>
  )
}

/** Stable key for a segment, matching the historical per-kind key shape. */
export function assistantSegmentKey(
  keyPrefix: string | number,
  seg: AssistantVisualSegment,
  isStreaming: boolean,
): string {
  if (seg.kind === 'reasoning') return `${keyPrefix}-seq-r-${seg.originIndex}-${seg.block.key}`
  if (seg.kind === 'browser') return `${keyPrefix}-seq-${seg.originIndex}-${seg.block.key}`
  if (seg.kind === 'tools') {
    const onlyTools = seg.items.every((it) => it.kind === 'tool')
    if (onlyTools && seg.items.length === 1) {
      const t = seg.items[0] as ToolVisualBlock
      if (!isStreaming && getDraftFromToolBlock(t)) {
        return `${keyPrefix}-draft-${seg.originIndex}-${t.key}`
      }
      if (isOverlayGatedToolOutput(t.toolOutput)) {
        return `${keyPrefix}-gated-${seg.originIndex}-${t.key}`
      }
      return `${keyPrefix}-seq-${seg.originIndex}-${t.key}`
    }
    return `${keyPrefix}-seq-tools-${seg.originIndex}`
  }
  if (seg.kind === 'file') return `${keyPrefix}-seq-${seg.originIndex}-file`
  if (seg.kind === 'generated-ui') return `${keyPrefix}-seq-${seg.originIndex}-${seg.block.part.id}`
  return `${keyPrefix}-seq-${seg.originIndex}-text`
}
