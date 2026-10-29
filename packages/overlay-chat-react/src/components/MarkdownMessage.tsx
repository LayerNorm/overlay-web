import 'katex/dist/katex.min.css'
import { OverlayMark } from '@overlay/ui'
import { type ReactNode, memo, useMemo, useState } from 'react'
import { AtSign, BookOpen, Bot, FileText, Hash, Plug, Server, Sparkles } from 'lucide-react'
import { Streamdown } from 'streamdown'
import type { Pluggable } from 'unified'
import type { SourceCitationMap } from '../lib/source-citations'
import { knowledgeChipLabel, knowledgeSourcesFromCitations } from '../lib/knowledge-sources'
import { webSourceDisplayKey, type WebSourceItem } from '../lib/web-sources'
import { WebSourceTooltip } from './WebSourceTooltip'
import type {
  AttachmentPreview,
  AttachmentPreviewOpenOptions,
} from './AttachmentPreviewShell'
import { normalizeGeneratedMarkdown } from './markdown/normalization'
import { streamdownMath, streamdownRehypePlugins, streamdownRemarkPlugins } from './markdown/plugins'
import { createBaseMdComponents, extractLinkText } from './markdown/renderers'
import { recordRender, timeSync } from '../lib/perf-debug'
import {
  remarkOverlayMentions,
  isMentionHref,
  mentionChipClass,
  type ChatMessageMention,
} from './markdown/mentions'

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
  /** Known mentions render as the same distinct pills used by the composer. */
  mentions?: ChatMessageMention[]
  /** Optional avatar renderer for mention chips (e.g. agent creatures). Falls back to the type icon. */
  renderMentionAvatar?: (mention: ChatMessageMention) => ReactNode
  /** Host-authorized saved paths can open their canonical Files records. */
  resolveFileHref?: (href: string) => string | undefined
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
  resolveFileHref,
  appBaseUrl = null,
  mentions,
  renderMentionAvatar,
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
          linkifyCitations: hasCitationMap,
          webSources,
          // Linkify web citations even while streaming so inline chips render with the text,
          // instead of appearing only after completion.
          linkifyWebCitations: hasWebSources,
        }),
      ),
    [text, sourceCitations, hasCitationMap, webSources, hasWebSources, appBaseUrl],
  )

  // Ordered the same way the chip hrefs are numbered, so `#overlay-knowcite-2`
  // is the second citation in the map.
  // Parents pass new citation/source arrays on every render. Keeping the
  // markdown components stable lets Streamdown reuse finished blocks (and their KaTeX)
  // while a reply streams instead of re-rendering the whole message per token.
  const stableSourceCitations = useValueStable(sourceCitations, sameCitations)
  const stableWebSources = useValueStable(webSources, sameWebSources)

  const knowledgeSources = useMemo(
    () => knowledgeSourcesFromCitations(stableSourceCitations, appBaseUrl),
    [stableSourceCitations, appBaseUrl],
  )

  const mdRenderComponents = useMemo(
    () => {
      const baseComponents = createBaseMdComponents({ onOpenAttachmentPreview })
      const chipClass =
        'overlay-webcite-chip mx-0.5 inline-flex max-w-full cursor-pointer items-baseline rounded-full border border-(--border) bg-(--surface-subtle) px-2 py-0.5 align-baseline text-[11px] font-normal leading-none text-(--muted) no-underline! transition-colors hover:bg-(--surface-elevated) hover:text-(--foreground)'

      const renderChip = (href: string, label: string, tooltipSources: WebSourceItem[]) => (
        <WebSourceTooltip sources={tooltipSources}>
          <a href={href} target="_blank" rel="noopener noreferrer" className={chipClass}>
            {label}
          </a>
        </WebSourceTooltip>
      )

      /** Knowledge chips stay in the app — same chip, same hover card, no new tab. */
      const renderInternalChip = (href: string, label: string, tooltipSources: WebSourceItem[]) => (
        <WebSourceTooltip sources={tooltipSources}>
          <a href={href} className={chipClass}>
            {label}
          </a>
        </WebSourceTooltip>
      )

      return {
        ...baseComponents,
        // Keep semantic emphasis; Streamdown's defaults render styled spans.
        strong: ({ children }: { children?: ReactNode }) => <strong>{children}</strong>,
        em: ({ children }: { children?: ReactNode }) => <em>{children}</em>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        a(props: any) {
          const href = props.href
          const savedHref = typeof href === 'string' ? resolveFileHref?.(href) : undefined
          if (savedHref) return <a href={savedHref}>{props.children}</a>
          const linkText = extractLinkText(props.children as ReactNode).trim()

          if (isMentionHref(href)) {
            const encodedId = typeof href === 'string' ? href.slice('#overlay-mention-'.length) : ''
            const mention = mentions?.find((item) => encodeURIComponent(item.id) === encodedId)
            const avatar = mention ? renderMentionAvatar?.(mention) : undefined
            const Icon = mention?.type === 'file' ? FileText
              : mention?.type === 'knowledge' ? BookOpen
                : mention?.type === 'connector' ? Plug
                  : mention?.type === 'automation' || mention?.type === 'agent' ? Bot
                    : mention?.type === 'skill' ? Sparkles
                      : mention?.type === 'mcp' ? Server
                        : mention?.type === 'chat' ? Hash
                          : AtSign
            return <span className={`${mentionChipClass} gap-1`}>{avatar ?? <Icon size={11} strokeWidth={1.75} aria-hidden="true" />}{props.children}</span>
          }

          // Knowledge citation chip: `#overlay-knowcite-N` (a cited file or memory).
          if (typeof href === 'string' && href.startsWith('#overlay-knowcite-')) {
            const n = parseInt(href.slice('#overlay-knowcite-'.length), 10)
            const source = knowledgeSources[n - 1]
            const citation = stableSourceCitations?.[String(n)]
            if (source?.internalHref) {
              const label = linkText || (citation ? knowledgeChipLabel(citation) : source.title)
              return renderInternalChip(source.internalHref, label, [source])
            }
            return <span className="mx-0.5 text-[11px] text-(--muted) tabular-nums">[{n}]</span>
          }

          // Multi-citation chip: `#overlay-webcite-multi-1-2-3`
          if (typeof href === 'string' && href.startsWith('#overlay-webcite-multi-')) {
            const raw = href.slice('#overlay-webcite-multi-'.length)
            const indices = raw
              .split('-')
              .map((s) => parseInt(s, 10))
              .filter((n) => Number.isFinite(n) && n >= 1 && n <= (stableWebSources?.length ?? 0))
            const picked = indices.map((i) => stableWebSources![i - 1]!).filter(Boolean)
            if (picked.length > 0) {
              // Multi-chip opens the first source on click; tooltip surfaces the rest.
              return renderChip(picked[0]!.url, linkText || webSourceDisplayKey(picked[0]!.url), picked)
            }
            return <span className="mx-0.5 text-[11px] text-(--muted) tabular-nums">[{raw}]</span>
          }

          // Single citation chip: `#overlay-webcite-N`
          if (typeof href === 'string' && href.startsWith('#overlay-webcite-')) {
            const raw = href.slice('#overlay-webcite-'.length)
            const n = parseInt(raw, 10)
            const src = stableWebSources?.[n - 1]
            if (src) {
              return renderChip(src.url, linkText || webSourceDisplayKey(src.url), [src])
            }
            return <span className="mx-0.5 text-[11px] text-(--muted) tabular-nums">[{raw}]</span>
          }

          // Generic external URL → also render as chip with a tooltip. Skip Connect-service
          // links (handled by baseMdComponents.a) and internal /app/ / hash / mailto links.
          if (
            typeof href === 'string' &&
            /^https?:\/\//i.test(href) &&
            !/^connect\s+/i.test(linkText)
          ) {
            // Prefer metadata from `stableWebSources` when this URL was one of the collected sources.
            const matched = stableWebSources?.find((s) => s.url === href)
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
              <span className="whitespace-pre-wrap wrap-break-word text-(--foreground)">
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
    [knowledgeSources, stableSourceCitations, stableWebSources, appBaseUrl, mentions, renderMentionAvatar, onOpenAttachmentPreview, resolveFileHref],
  )
  const activeRemarkPlugins = useMemo(
    (): Pluggable[] => [...streamdownRemarkPlugins, [remarkOverlayMentions, { mentions: mentions ?? [] }]],
    [mentions],
  )
  const showInlineMarker = isStreaming && !suppressTypingIndicator

  if (!normalizedDisplay.trim() && !isStreaming) {
    return null
  }

  // Keep Streamdown's block tree through completion; switching to static mode
  // replaces the rendered blocks when the final chunk settles.
  return (
    <div className="typeset markdown-content">
      <Streamdown
        mode="streaming"
        isAnimating={isStreaming}
        parseIncompleteMarkdown
        controls={false}
        remarkPlugins={activeRemarkPlugins}
        rehypePlugins={streamdownRehypePlugins}
        plugins={STREAMDOWN_PLUGINS}
        components={mdRenderComponents}
      >
        {normalizedDisplay}
      </Streamdown>
      {showInlineMarker ? (
        <span className="overlay-stream-marker" aria-hidden>
          <OverlayMark motion="look" size={14} label="" />
        </span>
      ) : null}
    </div>
  )
}

const STREAMDOWN_PLUGINS = { math: streamdownMath }

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
function useValueStable<T>(value: T, same: (a: T, b: T) => boolean): T {
  const [stable, setStable] = useState(value)
  const isSame = stable === value || same(stable, value)
  if (!isSame) setStable(value)
  return isSame ? stable : value
}

export const MarkdownMessage = memo(MarkdownMessageImpl, (prev, next) => {
  return (
    prev.text === next.text &&
    prev.isStreaming === next.isStreaming &&
    prev.resolveFileHref === next.resolveFileHref &&
    prev.suppressTypingIndicator === next.suppressTypingIndicator &&
    prev.appBaseUrl === next.appBaseUrl &&
    prev.mentions === next.mentions &&
    prev.renderMentionAvatar === next.renderMentionAvatar &&
    sameCitations(prev.sourceCitations, next.sourceCitations) &&
    sameWebSources(prev.webSources, next.webSources)
  )
})
