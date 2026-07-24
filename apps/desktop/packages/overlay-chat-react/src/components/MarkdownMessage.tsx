import 'katex/dist/katex.min.css'
import { type ReactNode, memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import type { SourceCitationMap } from '../lib/source-citations'
import { webSourceDisplayKey, type WebSourceItem } from '../lib/web-sources'
import { shimIncompleteMarkdown } from '../lib/shim-incomplete-markdown'
import type { ChatStreamingMode } from '../context/chat-settings'
import { WebSourceTooltip } from './WebSourceTooltip'
import type {
  AttachmentPreview,
  AttachmentPreviewOpenOptions,
} from './AttachmentPreviewShell'
import { appendStreamMarker, normalizeGeneratedMarkdown } from './markdown/normalization'
import { markdownRehypePlugins, markdownRehypePluginsStreaming, markdownRemarkPlugins } from './markdown/plugins'
import { createBaseMdComponents, extractLinkText } from './markdown/renderers'
import { splitStreamingMarkdown, useSmoothStreamedText } from './markdown/streaming'
import { recordRender, timeSync } from '../lib/perf-debug'

interface Props {
  text: string
  isStreaming: boolean
  /** From stream metadata — links [n] on **Sources:** lines to Knowledge */
  sourceCitations?: SourceCitationMap
  /** Web search / browser tool results — inline `[n]` chips + sidebar (parent) */
  webSources?: WebSourceItem[]
  /**
   * When true, do not render the trailing streaming marker here (parent shows a single
   * indicator at the bottom). Still renders completed paragraph blocks plus the
   * in-flight tail so text streams without a duplicate marker mid-message.
   */
  suppressTypingIndicator?: boolean
  /** Prefix for /app/* markdown links (extension host). */
  appBaseUrl?: string | null
  /**
   * 'token' (default): render the full normalized text through one ReactMarkdown pass
   *   every update, with a shim that closes open structures so partial markdown still
   *   renders styled. Shows a pulsing Overlay logo at the tail of the most recent token
   *   (or standalone before any tokens arrive); each new block element fades in as it
   *   enters the DOM.
   * 'chunk': split into completed paragraph blocks + a separate tail block, with the
   *   pulsing Overlay logo as the trailing indicator. Steadier but content appears
   *   in jumps.
  */
  streamingMode?: ChatStreamingMode
  onOpenAttachmentPreview?: (
    preview: AttachmentPreview,
    options?: AttachmentPreviewOpenOptions,
  ) => void
}

function MarkdownMessageImpl({
  text,
  isStreaming,
  sourceCitations,
  webSources,
  suppressTypingIndicator = false,
  streamingMode = 'token',
  appBaseUrl = null,
  onOpenAttachmentPreview,
}: Props) {
  recordRender(isStreaming ? 'MarkdownMessage(streaming)' : 'MarkdownMessage')
  const hasCitationMap = !!(sourceCitations && Object.keys(sourceCitations).length > 0)
  const hasWebSources = !!(webSources && webSources.length > 0)
  const normalizedDisplay = useMemo(
    () =>
      timeSync('normalizeGeneratedMarkdown', () =>
        normalizeGeneratedMarkdown(text, {
          sourceCitations,
          appBaseUrl,
          linkifyCitations: !isStreaming && hasCitationMap,
          webSources,
          // Linkify web citations even while streaming so inline chips render with the text,
          // instead of appearing only after completion.
          linkifyWebCitations: hasWebSources,
        }),
      ),
    [text, sourceCitations, isStreaming, hasCitationMap, webSources, hasWebSources, appBaseUrl],
  )

  const mdRenderComponents = useMemo(
    () => {
      const baseComponents = createBaseMdComponents({ onOpenAttachmentPreview })
      const chipClass =
        'overlay-webcite-chip mx-0.5 inline-flex max-w-full cursor-pointer items-baseline rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-0.5 align-baseline text-[11px] font-normal leading-none text-[var(--muted)] no-underline! transition-colors hover:bg-[var(--surface-elevated)] hover:text-[var(--foreground)]'

      const renderChip = (href: string, label: string, tooltipSources: WebSourceItem[]) => (
        <WebSourceTooltip sources={tooltipSources}>
          <a href={href} target="_blank" rel="noopener noreferrer" className={chipClass}>
            {label}
          </a>
        </WebSourceTooltip>
      )

      return {
        ...baseComponents,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        a(props: any) {
          const href = props.href
          const linkText = extractLinkText(props.children as ReactNode).trim()

          // Multi-citation chip: `#overlay-webcite-multi-1-2-3`
          if (typeof href === 'string' && href.startsWith('#overlay-webcite-multi-')) {
            const raw = href.slice('#overlay-webcite-multi-'.length)
            const indices = raw
              .split('-')
              .map((s) => parseInt(s, 10))
              .filter((n) => Number.isFinite(n) && n >= 1 && n <= (webSources?.length ?? 0))
            const picked = indices.map((i) => webSources![i - 1]!).filter(Boolean)
            if (picked.length > 0) {
              // Multi-chip opens the first source on click; tooltip surfaces the rest.
              return renderChip(picked[0]!.url, linkText || webSourceDisplayKey(picked[0]!.url), picked)
            }
            return <span className="mx-0.5 text-[11px] text-[var(--muted)] tabular-nums">[{raw}]</span>
          }

          // Single citation chip: `#overlay-webcite-N`
          if (typeof href === 'string' && href.startsWith('#overlay-webcite-')) {
            const raw = href.slice('#overlay-webcite-'.length)
            const n = parseInt(raw, 10)
            const src = webSources?.[n - 1]
            if (src) {
              return renderChip(src.url, linkText || webSourceDisplayKey(src.url), [src])
            }
            return <span className="mx-0.5 text-[11px] text-[var(--muted)] tabular-nums">[{raw}]</span>
          }

          // Generic external URL → also render as chip with a tooltip. Skip Connect-service
          // links (handled by baseMdComponents.a) and internal /app/ / hash / mailto links.
          if (
            typeof href === 'string' &&
            /^https?:\/\//i.test(href) &&
            !/^connect\s+/i.test(linkText)
          ) {
            // Prefer metadata from `webSources` when this URL was one of the collected sources.
            const matched = webSources?.find((s) => s.url === href)
            const fallback: WebSourceItem = matched ?? {
              url: href,
              title: '',
              origin: 'web-search',
            }
            const isTextJustUrl =
              !linkText || linkText === href || /^https?:\/\//i.test(linkText)
            const chipLabel = isTextJustUrl ? webSourceDisplayKey(href) : linkText
            return renderChip(href, chipLabel, [fallback])
          }

          // Internal `/app/...` routes. Long garbled pasted links are rendered
          // as plain text; otherwise resolve against `appBaseUrl` when provided.
          if (
            typeof href === 'string' &&
            href.startsWith('/app/') &&
            (href.length > 96 || href.includes('%7C') || href.includes('|'))
          ) {
            return (
              <span className="whitespace-pre-wrap wrap-break-word text-[var(--foreground)]">
                {props.children}
              </span>
            )
          }
          if (typeof href === 'string' && href.startsWith('/app/')) {
            const abs = appBaseUrl ? `${appBaseUrl.replace(/\/$/, '')}${href}` : href
            return (
              <a
                href={abs}
                className="text-[#2563eb] underline underline-offset-2 font-medium hover:text-[#1d4ed8]"
              >
                {props.children}
              </a>
            )
          }

          return baseComponents.a(props)
        },
      }
    },
    [webSources, appBaseUrl, onOpenAttachmentPreview],
  )
  // Smooth pacer: while streaming in token mode, reveal the normalized text one
  // character at a time at a steady rate. When not streaming (or in chunk mode),
  // this returns `normalizedDisplay` immediately so historical renders are untouched.
  const pacedDisplay = useSmoothStreamedText(
    normalizedDisplay,
    isStreaming,
    streamingMode === 'token',
  )

  // Token mode: render the entire shimmed document in one pass so React can reconcile
  // stable nodes and only the tail paragraph/row/code-line actually re-renders.
  // Append the streaming marker inline so the Overlay logo sits at the right side
  // of the most recent token (and pulses while generation continues).
  const tokenDisplay = useMemo(() => {
    if (!(isStreaming && streamingMode === 'token')) return normalizedDisplay
    const shimmed = shimIncompleteMarkdown(pacedDisplay)
    return appendStreamMarker(shimmed)
  }, [normalizedDisplay, pacedDisplay, isStreaming, streamingMode])

  // Activate the per-character wrap plugin only while streaming in token mode.
  // Outside streaming, the plain rehype pipeline runs so the final DOM is clean
  // plain text (no span-per-character overhead in chat history).
  const activeRehypePlugins = useMemo(() => {
    if (isStreaming && streamingMode === 'token') return markdownRehypePluginsStreaming
    return markdownRehypePlugins
  }, [isStreaming, streamingMode])

  // Chunk mode only: paragraph split + trailing pulsing marker. Token mode always
  // uses the single-pass render below (both during and after streaming) so React
  // reconciles the existing DOM when streaming ends instead of unmounting the whole
  // subtree and re-animating every block — which previously caused a one-shot
  // "whole answer blinks" flash at the moment the response finished.
  const { completedBlocks, streamTail } = useMemo(
    () => splitStreamingMarkdown(normalizedDisplay),
    [normalizedDisplay],
  )
  const trailingBlock = !isStreaming && streamTail.trim() ? streamTail.trim() : ''
  const inChunkMode = streamingMode === 'chunk'
  const showInlineTypingDots = isStreaming && !suppressTypingIndicator && inChunkMode

  if (!normalizedDisplay.trim() && !isStreaming) {
    return null
  }

  if (!inChunkMode) {
    // Token mode — single ReactMarkdown pass over the (optionally shimmed + marker)
    // text. While streaming, the `markdown-content--streaming` class plays a gentle
    // opacity/translate fade-in each time a new block (paragraph, list item, table
    // row, heading, pre, blockquote) enters the DOM; within a given block, continued
    // token updates just extend the existing text so the pulsing
    // `.overlay-stream-marker` at the tail carries the "still generating" cue. When
    // no tokens have arrived yet, the marker stands alone and scales up via CSS to
    // act as a large "thinking" indicator. When streaming ends, the class is dropped
    // and the marker disappears, but the underlying ReactMarkdown tree stays mounted
    // so the transition is seamless (no remount, no re-animation).
    return (
      <div className={`markdown-content${isStreaming ? ' markdown-content--streaming' : ''}`}>
        <ReactMarkdown
          remarkPlugins={markdownRemarkPlugins}
          rehypePlugins={activeRehypePlugins}
          components={mdRenderComponents}
        >
          {tokenDisplay}
        </ReactMarkdown>
      </div>
    )
  }

  return (
    <div className="markdown-content">
      {completedBlocks.map((block, index) => (
        <div key={`md-block-${index}`} className="md-block-appear">
          <ReactMarkdown
            remarkPlugins={markdownRemarkPlugins}
            rehypePlugins={markdownRehypePlugins}
            components={mdRenderComponents}
          >
            {block}
          </ReactMarkdown>
        </div>
      ))}

      {trailingBlock ? (
        <div key={`md-block-${completedBlocks.length}`} className="md-block-appear">
          <ReactMarkdown
            remarkPlugins={markdownRemarkPlugins}
            rehypePlugins={markdownRehypePlugins}
            components={mdRenderComponents}
          >
            {trailingBlock}
          </ReactMarkdown>
        </div>
      ) : null}

      {showInlineTypingDots ? (
        <span className="overlay-stream-marker" aria-hidden />
      ) : null}
    </div>
  )
}

function sameWebSources(a?: WebSourceItem[], b?: WebSourceItem[]): boolean {
  if (a === b) return true
  const al = a?.length ?? 0
  const bl = b?.length ?? 0
  if (al !== bl) return false
  for (let i = 0; i < al; i++) {
    if (a![i]!.url !== b![i]!.url) return false
  }
  return true
}

function sameCitations(a?: SourceCitationMap, b?: SourceCitationMap): boolean {
  if (a === b) return true
  const ak = a ? Object.keys(a) : []
  const bk = b ? Object.keys(b) : []
  if (ak.length !== bk.length) return false
  for (const k of ak) {
    if (!b || !(k in b)) return false
  }
  return true
}

/**
 * Memoized so a completed message never re-parses its markdown/KaTeX when an unrelated
 * message streams. Comparison is value-based for `webSources` / `sourceCitations`
 * (their identities change every parent render); `onOpenAttachmentPreview` identity is
 * intentionally ignored since its behavior is stable. While a message is actively
 * streaming, `text` changes each (throttled) update so it still re-renders normally.
 */
export const MarkdownMessage = memo(MarkdownMessageImpl, (prev, next) => {
  return (
    prev.text === next.text &&
    prev.isStreaming === next.isStreaming &&
    prev.streamingMode === next.streamingMode &&
    prev.suppressTypingIndicator === next.suppressTypingIndicator &&
    prev.appBaseUrl === next.appBaseUrl &&
    sameCitations(prev.sourceCitations, next.sourceCitations) &&
    sameWebSources(prev.webSources, next.webSources)
  )
})
