/* eslint-disable @next/next/no-img-element -- shared renderer must stay platform-neutral */
import { unstyledButton } from '@overlay/ui/control-reset'
import { Button } from '@overlay/ui/primitives'
import { fileContentHref, getDraftFromToolBlock, isOverlayGatedToolOutput } from '@overlay/chat-core'
import { File, FileText, Film, Image as ImageIcon, Play } from 'lucide-react'
import { lazy, Suspense, type ComponentProps, type ReactNode } from 'react'
import type {
  AssistantVisualSegment,
  DraftModalState,
  ToolVisualBlock,
} from '@overlay/chat-core'
import type { GeneratedUiData } from '@overlay/chat-core/generated-ui'
import type { SourceCitationMap } from '../../lib/source-citations'
import type { WebSourceItem } from '../../lib/web-sources'
import { MarkdownMessage } from '../MarkdownMessage'
import { MarkdownConnectorActionsContext } from '../markdown/connector-actions-context'
import type {
  AttachmentPreview,
  AttachmentPreviewOpenOptions,
} from '../AttachmentPreviewShell'
import type { GeneratedUiConnectorActions } from '../GeneratedUiCard'
import {
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

const WEB_SEARCH_TOOL_NAMES = new Set([
  'perplexity_search',
  'parallel_search',
  'web_search',
  'deep_search',
  'web_fetch',
])
const MEMORY_TOOL_NAMES = new Set(['save_memory', 'save_memory_batch', 'update_memory'])

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
  resolveFileHref?: ComponentProps<typeof MarkdownMessage>['resolveFileHref']
  toolResourceHrefs?: ComponentProps<typeof MarkdownMessage>['toolResourceHrefs']
  onOpenDraft: (state: DraftModalState) => void
  onCreateAutomationDraft: (state: AutomationDraftModalState) => void | Promise<void>
  onOpenAttachmentPreview?: (
    preview: AttachmentPreview,
    options?: AttachmentPreviewOpenOptions,
  ) => void
  generatedUiConnectorActions?: GeneratedUiConnectorActions
  generatedUiReadOnly?: boolean
  onGeneratedUiChange?: (partId: string, data: GeneratedUiData) => void
}

type SegmentItemProps<K extends AssistantVisualSegment['kind']> = {
  seg: Extract<AssistantVisualSegment, { kind: K }>
  chainTop: boolean
  chainBottom: boolean
  ctx: AssistantSegmentRenderContext
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
    return (
      <ReasoningSegmentItem seg={seg} chainTop={chainTop} chainBottom={chainBottom} ctx={ctx} />
    )
  }
  if (seg.kind === 'tools') {
    return (
      <ToolsSegmentItem seg={seg} chainTop={chainTop} chainBottom={chainBottom} ctx={ctx} />
    )
  }
  if (seg.kind === 'file') {
    return <FileSegmentItem seg={seg} chainTop={chainTop} chainBottom={chainBottom} ctx={ctx} />
  }
  if (seg.kind === 'generated-ui') {
    return <GeneratedUiSegmentItem seg={seg} chainTop={chainTop} chainBottom={chainBottom} ctx={ctx} />
  }
  return <TextSegmentItem seg={seg} chainTop={chainTop} chainBottom={chainBottom} ctx={ctx} />
}

function ReasoningSegmentItem({ seg, chainTop, chainBottom, ctx }: SegmentItemProps<'reasoning'>) {
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

function ToolsSegmentItem({ seg, chainTop, chainBottom, ctx }: SegmentItemProps<'tools'>) {
  const onlyTools = seg.items.every((it): it is ToolVisualBlock => it.kind === 'tool')
  if (onlyTools && seg.items.length === 1) {
    return (
      <SingleToolSegmentItem
        block={seg.items[0] as ToolVisualBlock}
        chainTop={chainTop}
        chainBottom={chainBottom}
        ctx={ctx}
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

function SingleToolSegmentItem({
  block,
  chainTop,
  chainBottom,
  ctx,
}: {
  block: ToolVisualBlock
  chainTop: boolean
  chainBottom: boolean
  ctx: AssistantSegmentRenderContext
}) {
  // Only promote a draft to its card once the turn is finished. Mid-stream
  // this segment is a lone tool block, so the card mounts, then unmounts the
  // moment the next tool call regroups the segment, then remounts at the end
  // — reading as a card that flickers in and collapses. While streaming, let
  // it render as an ordinary tool block instead.
  const draft = ctx.isStreaming ? null : getDraftFromToolBlock(block)
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
  if (isOverlayGatedToolOutput(block.toolOutput)) {
    return (
      <GatedPaidFeatureCallout
        block={block}
        connectTop={chainTop}
        connectBottom={chainBottom}
      />
    )
  }
  if (WEB_SEARCH_TOOL_NAMES.has(block.name)) {
    return (
      <WebSearchToolBlock
        block={block}
        connectTop={chainTop}
        connectBottom={chainBottom}
      />
    )
  }
  if (MEMORY_TOOL_NAMES.has(block.name)) {
    return (
      <MemoryToolBlock
        block={block}
        connectTop={chainTop}
        connectBottom={chainBottom}
      />
    )
  }
  return (
    <SingleToolCallRow
      block={block}
      connectTop={chainTop}
      connectBottom={chainBottom}
    />
  )
}

function FilePreviewButton({
  onOpen,
  children,
  className,
}: {
  onOpen: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <Button variant="ghost"
      type="button"
      onClick={onOpen}
      className={unstyledButton(`h-auto min-w-0 max-w-full rounded-xl outline-hidden transition-transform hover:scale-[1.005] focus-visible:ring-2 focus-visible:ring-(--foreground) focus-visible:ring-offset-2 focus-visible:ring-offset-(--background) ${className ?? ''}`)}
      title="Open attachment"
    >
      {children}
    </Button>
  )
}

function FileSegmentItem({ seg, ctx }: SegmentItemProps<'file'>) {
  const block = seg.block
  const reference = block.fileReference
  if (reference) {
    const href = fileContentHref(reference.fileId)
    const image = reference.mimeType.startsWith('image/')
    const video = reference.mimeType.startsWith('video/')
    const Icon = image ? ImageIcon : video ? Film : reference.mimeType.startsWith('text/') ? FileText : File
    const openPreview = () => ctx.onOpenAttachmentPreview?.({
      name: reference.name,
      content: '',
      url: href,
      fileId: reference.fileId,
      mimeType: reference.mimeType,
      ...(reference.sizeBytes === undefined ? {} : { sizeBytes: reference.sizeBytes }),
    }, { mode: 'panel' })
    const metadata = [formatFileSize(reference.sizeBytes), reference.durationMs ? formatDuration(reference.durationMs) : null]
      .filter(Boolean).join(' · ')
    return (
      <div className="px-1 py-1">
        <Button variant="ghost" type="button" onClick={openPreview} title={`Preview ${reference.name}`}
          className={unstyledButton(`h-auto ${image ? 'w-[240px]' : 'w-[288px]'} min-w-0 max-w-full rounded-xl p-0 text-left focus-visible:ring-2 focus-visible:ring-(--foreground) focus-visible:ring-offset-2 focus-visible:ring-offset-(--background)`)}>
          {video ? (
            <span className="flex w-full min-w-0 flex-col gap-2">
              <span className="relative block aspect-video overflow-hidden rounded-xl border border-(--border) bg-(--surface-subtle)">
                <video src={href} preload="metadata" playsInline aria-hidden="true" className="h-full w-full object-cover" />
                <span className="absolute inset-0 grid place-items-center bg-black/20 text-white"><Play size={30} fill="currentColor" /></span>
              </span>
              <span className="flex min-w-0 items-center gap-2 px-1">
                <Film size={15} className="shrink-0 text-(--muted)" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-(--foreground)">{reference.name}</span>
                {metadata ? <span className="shrink-0 text-[11px] text-(--muted)">{metadata}</span> : null}
              </span>
            </span>
          ) : image ? (
            <span className="flex w-full min-w-0 flex-col gap-1.5">
              <img src={href} alt={reference.name} className="max-h-64 w-full rounded-xl border border-(--border) object-contain" />
              <span className="flex min-w-0 items-center gap-2 px-1">
                <ImageIcon size={14} className="shrink-0 text-(--muted)" />
                <span className="truncate text-xs font-medium text-(--foreground)">{reference.name}</span>
              </span>
            </span>
          ) : (
            <span className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg border border-(--border) bg-(--surface) px-3 py-2">
              <Icon size={16} className="shrink-0 text-(--muted)" />
              <span className="min-w-0 truncate text-xs font-medium text-(--foreground)">{reference.name}</span>
              {metadata ? <span className="shrink-0 text-[11px] text-(--muted)">{metadata}</span> : null}
            </span>
          )}
        </Button>
      </div>
    )
  }
  const isImg = (block.mediaType?.startsWith('image/') ?? true)
  const isVideo = block.mediaType?.startsWith('video/') ?? false
  const fileType = isImg ? 'image' : isVideo ? 'video' : 'file'
  const previewName = isImg ? 'generated-image.png' : isVideo ? 'generated-video.mp4' : fileNameFromUrl(block.url)
  const Icon = block.mediaType?.startsWith('text/') ? FileText : File
  const openPreview = () =>
    ctx.onOpenAttachmentPreview?.({ name: previewName, content: block.url, url: block.url, mimeType: block.mediaType })
  return (
    <div className="w-full px-1 py-1">
      {fileType === 'image' ? (
        <FilePreviewButton onOpen={openPreview} className="w-[240px]">
          <img
            src={block.url}
            alt="Generated"
            className="max-h-64 w-full rounded-xl border border-(--border) object-contain"
          />
        </FilePreviewButton>
      ) : fileType === 'video' ? (
        <FilePreviewButton onOpen={openPreview} className="w-[288px]">
          <video
            src={block.url}
            preload="metadata"
            playsInline
            aria-hidden="true"
            className="pointer-events-none aspect-video w-full rounded-xl border border-(--border) object-cover"
          />
        </FilePreviewButton>
      ) : (
        <FilePreviewButton onOpen={openPreview} className="w-[288px]">
          <span className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg border border-(--border) bg-(--surface) px-3 py-2 text-left">
            <Icon size={16} className="shrink-0 text-(--muted)" />
            <span className="min-w-0 truncate text-xs font-medium text-(--foreground)">{previewName}</span>
          </span>
        </FilePreviewButton>
      )}
    </div>
  )
}

function fileNameFromUrl(value: string): string {
  try {
    const segments = new URL(value, 'https://overlay.invalid').pathname.split('/').filter(Boolean)
    const last = segments.at(-1)
    const segment = last === 'content' ? segments.at(-2) : last
    return segment ? decodeURIComponent(segment) : 'File'
  } catch {
    return 'File'
  }
}

function formatFileSize(size?: number) {
  if (!size || !Number.isFinite(size)) return null
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatDuration(durationMs: number) {
  const seconds = Math.floor(durationMs / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function GeneratedUiSegmentItem({ seg, ctx }: SegmentItemProps<'generated-ui'>) {
  return (
    <Suspense
      fallback={<div className="ui-skeleton-line min-h-24 w-full rounded-lg" aria-busy="true" />}
    >
      <GeneratedUiCard
        part={seg.block.part}
        readOnly={ctx.generatedUiReadOnly}
        connectorActions={ctx.generatedUiConnectorActions}
        onDataChange={ctx.onGeneratedUiChange}
      />
    </Suspense>
  )
}

function TextSegmentItem({ seg, ctx }: SegmentItemProps<'text'>) {
  const block = seg.block
  const isLastText = seg.originIndex === ctx.lastTextBlockIndex
  return (
    <div
      className="w-full px-1 py-1 text-sm leading-relaxed text-(--foreground)"
    >
      <MarkdownConnectorActionsContext.Provider value={ctx.generatedUiConnectorActions}>
        <MarkdownMessage
          key={`md-${ctx.markdownKeyPrefix}-${seg.originIndex}`}
          text={block.text}
          isStreaming={ctx.isTextStreaming && isLastText}
          sourceCitations={isLastText ? ctx.sourceCitations : undefined}
          webSources={isLastText && ctx.webSources && ctx.webSources.length > 0 ? ctx.webSources : undefined}
          suppressTypingIndicator={ctx.suppressTypingIndicator}
          resolveFileHref={ctx.resolveFileHref}
          toolResourceHrefs={ctx.toolResourceHrefs}
          onOpenAttachmentPreview={ctx.onOpenAttachmentPreview}
        />
      </MarkdownConnectorActionsContext.Provider>
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
