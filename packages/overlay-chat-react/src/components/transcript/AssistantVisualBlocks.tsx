/* eslint-disable @next/next/no-img-element -- shared renderer must stay platform-neutral */
import { lazy, Suspense, useMemo } from 'react'
import type { AssistantVisualBlock, DraftModalState, ToolVisualBlock } from '@overlay/chat-core'
import {
  buildAssistantVisualSegments,
  collectWebSourcesFromBlocks,
  computeToolChainFlags,
  getDraftFromToolBlock,
  isOverlayGatedToolOutput,
} from '@overlay/chat-core'
import type { GeneratedUiData } from '@overlay/chat-core/generated-ui'
import type { SourceCitationMap } from '../../lib/source-citations'
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
 */
export function AssistantVisualBlocks({
  blocks,
  blockKeyPrefix,
  markdownKeyPrefix,
  isStreaming,
  isTextStreaming,
  sourceCitations,
  suppressTypingIndicator = false,
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

  return (
    <>
      {segments.map((seg, segIdx) => {
        const chain = toolChainFlags[segIdx]!
        if (seg.kind === 'reasoning') {
          // Actively streaming = still emitting reasoning deltas (or message-level stream and
          // this part has not been explicitly marked `done`). Everything else collapses.
          const active =
            (isStreaming && seg.block.state === 'streaming') ||
            (isStreaming && seg.block.state !== 'done' && seg.originIndex === blocks.length - 1)
          return (
            <ReasoningBlock
              key={`${blockKeyPrefix}-seq-r-${seg.originIndex}-${seg.block.key}`}
              text={seg.block.text}
              streaming={active}
              connectTop={chain.chainTop}
              connectBottom={chain.chainBottom}
            />
          )
        }
        if (seg.kind === 'browser') {
          return (
            <BrowserToolBlock
              key={`${blockKeyPrefix}-seq-${seg.originIndex}-${seg.block.key}`}
              block={seg.block}
              connectTop={chain.chainTop}
              connectBottom={chain.chainBottom}
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
            const draft = isStreaming ? null : getDraftFromToolBlock(t)
            if (draft) {
              const isAutomationDraft = draft.kind === 'automation'
              return (
                <DraftSuggestionCard
                  key={`${blockKeyPrefix}-draft-${seg.originIndex}-${t.key}`}
                  title={draft.draft.name}
                  description={draft.draft.description}
                  badge={isAutomationDraft ? 'Automation Draft' : 'Skill Draft'}
                  reason={draft.draft.reason}
                  primaryLabel="Review draft"
                  secondaryLabel={isAutomationDraft ? 'Create automation' : 'Save skill'}
                  onPrimary={() => onOpenDraft(draft)}
                  onSecondary={() => {
                    if (draft.kind === 'automation') {
                      void onCreateAutomationDraft(draft)
                    } else {
                      onOpenDraft(draft)
                    }
                  }}
                />
              )
            }
            if (isOverlayGatedToolOutput(t.toolOutput)) {
              return (
                <GatedPaidFeatureCallout
                  key={`${blockKeyPrefix}-gated-${seg.originIndex}-${t.key}`}
                  block={t}
                  connectTop={chain.chainTop}
                  connectBottom={chain.chainBottom}
                />
              )
            }
            if (t.name === 'perplexity_search' || t.name === 'parallel_search') {
              return (
                <WebSearchToolBlock
                  key={`${blockKeyPrefix}-seq-${seg.originIndex}-${t.key}`}
                  block={t}
                  connectTop={chain.chainTop}
                  connectBottom={chain.chainBottom}
                />
              )
            }
            if (t.name === 'save_memory' || t.name === 'save_memory_batch' || t.name === 'update_memory') {
              return (
                <MemoryToolBlock
                  key={`${blockKeyPrefix}-seq-${seg.originIndex}-${t.key}`}
                  block={t}
                  connectTop={chain.chainTop}
                  connectBottom={chain.chainBottom}
                />
              )
            }
            return (
              <SingleToolCallRow
                key={`${blockKeyPrefix}-seq-${seg.originIndex}-${t.key}`}
                block={t}
                connectTop={chain.chainTop}
                connectBottom={chain.chainBottom}
              />
            )
          }
          return (
            <ToolCallsCollapsedGroup
              key={`${blockKeyPrefix}-seq-tools-${seg.originIndex}`}
              items={seg.items}
              connectTop={chain.chainTop}
              connectBottom={chain.chainBottom}
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
            <div key={`${blockKeyPrefix}-seq-${seg.originIndex}-file`} className="w-full px-1 py-1">
              {isImg ? (
                <button
                  type="button"
                  onClick={() => onOpenAttachmentPreview?.({ name: previewName, content: block.url, url: block.url })}
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
                  onClick={() => onOpenAttachmentPreview?.({ name: previewName, content: block.url, url: block.url })}
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
              key={`${blockKeyPrefix}-seq-${seg.originIndex}-${seg.block.part.id}`}
              fallback={<div className="ui-skeleton-line min-h-24 w-full rounded-lg" aria-busy="true" />}
            >
              <GeneratedUiCard
                part={seg.block.part}
                connectorActions={generatedUiConnectorActions}
                onDataChange={onGeneratedUiChange}
              />
            </Suspense>
          )
        }
        const block = seg.block
        const isLastText = seg.originIndex === lastTextBlockIndex
        return (
          <div
            key={`${blockKeyPrefix}-seq-${seg.originIndex}-text`}
            className="w-full px-1 py-1 text-sm leading-relaxed text-[var(--foreground)]"
          >
            <MarkdownMessage
              key={`md-${markdownKeyPrefix}-${seg.originIndex}`}
              text={block.text}
              isStreaming={isTextStreaming && isLastText}
              sourceCitations={isLastText ? sourceCitations : undefined}
              webSources={isLastText && webSources.length > 0 ? webSources : undefined}
              suppressTypingIndicator={suppressTypingIndicator}
              onOpenAttachmentPreview={onOpenAttachmentPreview}
            />
          </div>
        )
      })}
    </>
  )
}
