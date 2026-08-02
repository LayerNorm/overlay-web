'use client'

import {
  type ReactNode,
  lazy,
  Suspense,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { Pluggable } from 'unified'
import { mergeGfmTableContinuationLines } from '@/shared/markdown/markdown-table-fix'
import {
  normalizeAgentAssistantText,
  stripThinkingPlaceholderMarkdown,
} from '@/shared/chat/agent-assistant-text'
import type { SourceCitationMap } from '@/shared/knowledge/ask-knowledge-types'
import { linkifySourceCitationsMarkdown } from '@/shared/knowledge/source-citations'
import { linkifyInlineWebCitations, webSourceDisplayKey, type WebSourceItem } from '@/shared/web/web-sources'
import { safeHttpUrl } from '@/shared/security/safe-url'
import { shimIncompleteMarkdown } from '@/shared/markdown/shim-incomplete-markdown'
import { normalizeAssistantMathMarkdown } from '@/shared/markdown/math-markdown-normalize'
import { WebSourceTooltip } from './WebSourceTooltip'
import {
  getIntegrationLogoUrl,
  resolveSlugFromName,
  warmIntegrationLogoCache,
} from '@/shared/integrations/integration-logo-cache'

const LazySyntaxHighlighter = lazy(() => import('./LazySyntaxHighlighter'))

function useDocumentThemeIsDark(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const el = document.documentElement
      const obs = new MutationObserver(onStoreChange)
      obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] })
      return () => obs.disconnect()
    },
    () => document.documentElement.getAttribute('data-theme') === 'dark',
    () => false,
  )
}

function extractLinkText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractLinkText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractLinkText((node as { props: { children?: ReactNode } }).props.children)
  }
  return ''
}

const mdSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'br', 'span'],
  attributes: {
    ...defaultSchema.attributes,
    br: [],
    // Only allow the streaming indicator span class. rehype-sanitize drops other classes.
    span: [['className', 'overlay-stream-marker'], 'aria-hidden'],
  },
}

const humanMarkdownSchema = {
  ...defaultSchema,
  tagNames: [
    'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3',
    'h4', 'h5', 'h6', 'hr', 'li', 'ol', 'p', 'pre', 'strong', 'ul',
  ],
  attributes: {
    ...defaultSchema.attributes,
    a: [['href', /^(?:https?:\/\/|mailto:|#room-mention-)/i], 'title', 'target', 'rel'],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
  },
}

export type HumanMarkdownMention = { id: string; name: string; type: string }

const LOOSE_HUMAN_MENTION = /@[^\s@]+/g

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeMarkdownLinkText(value: string): string {
  return value.replace(/([\\[\]])/g, '\\$1')
}

/**
 * Keep room mentions as semantic markdown links until the restricted renderer
 * turns them into inert chips. This lets people use markdown and mentions in
 * the same message without allowing custom HTML or executable URLs.
 */
function withHumanMentionLinks(text: string, mentions: HumanMarkdownMention[]): string {
  const names = [...new Set(mentions.map((mention) => mention.name).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
  const pattern = names.length
    ? new RegExp(`@(?:${names.join('|')})|${LOOSE_HUMAN_MENTION.source}`, 'g')
    : new RegExp(LOOSE_HUMAN_MENTION.source, 'g')

  return text.replace(pattern, (label) => (
    `[${escapeMarkdownLinkText(label)}](#room-mention-${encodeURIComponent(label)})`
  ))
}

/** Restricted renderer for human room messages. Agent-only blocks and raw HTML stay disabled. */
export function HumanMarkdownMessage({
  text,
  mentions = [],
}: {
  text: string
  mentions?: HumanMarkdownMention[]
}) {
  const markdown = mentions.length > 0 && text.includes('@')
    ? withHumanMentionLinks(text, mentions)
    : text

  return (
    <div className="room-human-markdown min-w-0 whitespace-normal break-words text-sm leading-6">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, humanMarkdownSchema]]}
        components={{
          a: (props) => {
            const { children, href, node, ...anchorProps } = props
            void node
            if (typeof href === 'string' && href.startsWith('#room-mention-')) {
              return (
                <span className="mx-0.5 inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-1.5 py-0.5 align-middle text-xs font-medium text-[var(--foreground)]">
                  {children}
                </span>
              )
            }
            return (
              <a
                {...anchorProps}
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="underline decoration-[var(--muted-light)] underline-offset-2 hover:decoration-[var(--foreground)]"
              >
                {children}
              </a>
            )
          },
          code: ({ className, children, ...props }) => (
            <code
              {...props}
              className={`${className ?? ''} rounded bg-[var(--surface-subtle)] px-1 py-0.5 font-mono text-[0.9em]`}
            >
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="my-2 max-w-full overflow-x-auto rounded-lg bg-[var(--surface-subtle)] p-3 font-mono text-xs leading-5">
              {children}
            </pre>
          ),
          p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-[var(--border)] pl-3 text-[var(--muted)]">
              {children}
            </blockquote>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

function stripHtmlishToMarkdown(text: string): string {
  return text
    .replace(/<span\s+class=["']overlay-stream-marker["']\s+aria-hidden=["']true["']\s*><\/span>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<p>/gi, '')
    .replace(/<\/p>/gi, '')
    .replace(/<li>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<\/?(ul|ol)>/gi, '')
    .replace(/&nbsp;/gi, ' ')
}

/** Models often emit full-width lenticular brackets; normalize to ASCII for **Sources:** lines. */
function bracketNormalize(text: string): string {
  return text.replace(/【/g, '[').replace(/】/g, ']')
}

/**
 * Remove the trailing "Sources: …" prose block models emit at the end of web-search responses.
 * We surface sources via inline chips + the sources sidebar button, so the plaintext list is redundant.
 * Conservative: only strips when the block appears near the end of the message.
 */
function stripTrailingSourcesBlock(text: string): string {
  const lines = text.split('\n')
  // Find last non-empty line that starts a Sources: paragraph.
  let startIdx = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]!.trimStart()
    if (trimmed === '') continue
    if (/^(\*\*)?\s*(Sources|Citations|References)\s*:?/i.test(trimmed)) {
      startIdx = i
    }
    break
  }
  if (startIdx < 0) return text
  // Strip from the Sources: line through end-of-text (inclusive).
  const kept = lines.slice(0, startIdx)
  while (kept.length > 0 && kept[kept.length - 1]!.trim() === '') kept.pop()
  return kept.join('\n')
}

function normalizePersistedWebCitationMarkdown(text: string, hasWebSources: boolean): string {
  const dashChars = '\\-\\u2010-\\u2015\\u2212'
  const overlayCitationLink = new RegExp(
    `\\[([^\\]\\n]{1,80})\\]\\(#overlay[${dashChars}]webcite[${dashChars}]((?:multi[${dashChars}])?[\\d${dashChars}]+)\\)`,
    'g',
  )
  return text.replace(overlayCitationLink, (_match, label: string, rawIndex: string) => {
    if (!hasWebSources) return label
    const normalizedIndex = rawIndex.replace(/[\u2010-\u2015\u2212]/g, '-')
    return `[${label}](#overlay-webcite-${normalizedIndex})`
  })
}

function normalizeGeneratedMarkdown(
  text: string,
  options?: {
    sourceCitations?: SourceCitationMap
    linkifyCitations?: boolean
    webSources?: WebSourceItem[]
    linkifyWebCitations?: boolean
  },
): string {
  let t = mergeGfmTableContinuationLines(stripHtmlishToMarkdown(stripThinkingPlaceholderMarkdown(text)))
  t = bracketNormalize(t)
  t = normalizeAssistantMathMarkdown(t)
  const hasKnowledgeCitations =
    !!(options?.sourceCitations && Object.keys(options.sourceCitations).length > 0)
  const hasWebSources = !!(options?.webSources && options.webSources.length > 0)
  t = normalizePersistedWebCitationMarkdown(t, hasWebSources)
  // Strip the redundant trailing "Sources:" prose block — we surface web sources via the sidebar
  // button + inline chips. Keep the block when we only have knowledge citations (those still
  // rely on the numbered list for Knowledge linkify).
  if (hasWebSources && !hasKnowledgeCitations) {
    t = stripTrailingSourcesBlock(t)
  }
  if (
    options?.linkifyWebCitations &&
    options?.webSources &&
    options.webSources.length > 0
  ) {
    t = linkifyInlineWebCitations(t, options.webSources, {
      skipKnowledgeSourceLines: hasKnowledgeCitations,
    })
  }
  if (options?.linkifyCitations && hasKnowledgeCitations) {
    t = linkifySourceCitationsMarkdown(t, options.sourceCitations!)
  }
  return t
}

const CONNECT_SERVICE_DESCRIPTIONS: Record<string, string> = {
  'gmail': 'Compose, send, and search emails',
  'google calendar': 'Read and create calendar events',
  'google sheets': 'Read, update, and create spreadsheets',
  'google drive': 'Search and manage Drive files',
  'google meet': 'Join and manage video meetings',
  'notion': 'Create pages and manage workspace',
  'outlook': 'Send emails and manage calendar',
  'x (twitter)': 'Post tweets and manage your account',
  'twitter': 'Post tweets and manage your account',
  'asana': 'Create tasks and manage projects',
  'linkedin': 'Manage posts and profile actions',
}

// Custom code block with syntax highlighting and copy button
function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false)
  const isDark = useDocumentThemeIsDark()

  function handleCopy() {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-block-lang">{language}</span>
        <button type="button" className="code-block-copy" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy code'}
        </button>
      </div>
      <Suspense fallback={<pre className="m-0 overflow-x-auto p-3 text-sm"><code>{children}</code></pre>}>
        <LazySyntaxHighlighter isDark={isDark} language={language}>
          {children}
        </LazySyntaxHighlighter>
      </Suspense>
    </div>
  )
}

// ── Integration logo chip (lazy-fetches provider catalog logos via shared cache) ──────

function IntegrationLogoChip({ serviceName }: { serviceName: string }) {
  const [failed, setFailed] = useState(false)
  const slug = resolveSlugFromName(serviceName)
  const [logoUrl, setLogoUrl] = useState<string | null>(() =>
    slug ? getIntegrationLogoUrl(slug) : null
  )

  useEffect(() => {
    if (!slug) return
    if (getIntegrationLogoUrl(slug)) return
    let mounted = true
    warmIntegrationLogoCache().then(() => {
      if (!mounted) return
      const url = getIntegrationLogoUrl(slug)
      if (url) setLogoUrl(url)
    })
    return () => { mounted = false }
  }, [slug])

  if (logoUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={serviceName}
        width={20}
        height={20}
        className="h-5 w-5 object-contain"
        onError={() => setFailed(true)}
      />
    )
  }

  return <span className="text-xs font-bold text-foreground">{serviceName.charAt(0).toUpperCase()}</span>
}

// Stable markdown components — defined outside component to avoid re-creation
const baseMdComponents = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  a({ href, children }: any) {
    const linkText = extractLinkText(children as ReactNode).trim()
    const connectMatch = linkText.match(/^connect\s+(.+)$/i)

    const safeExternalHref = safeHttpUrl(href)

    if (connectMatch && safeExternalHref) {
      const serviceName = connectMatch[1].trim()
      const description =
        CONNECT_SERVICE_DESCRIPTIONS[serviceName.toLowerCase()] ||
        'Connect to use this integration'

      return (
        <a href={safeExternalHref} target="_blank" rel="noopener noreferrer" className="no-underline">
          <span
            className="my-1.5 inline-flex max-w-[360px] min-w-[260px] items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2.5 transition-colors hover:bg-[var(--surface-subtle)]"
          >
            <span
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] overflow-hidden"
            >
              <IntegrationLogoChip serviceName={serviceName} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium leading-snug text-[var(--foreground)]">{serviceName}</span>
              <span className="block text-xs leading-snug text-[var(--muted)]">{description}</span>
            </span>
            <span className="shrink-0 whitespace-nowrap rounded-md bg-[var(--foreground)] px-3 py-1.5 text-xs text-[var(--background)]">
              Connect
            </span>
          </span>
        </a>
      )
    }

    // Models sometimes wrap long pasted text as a link to `/app/...`, which becomes a client 404.
    if (
      typeof href === 'string' &&
      href.startsWith('/app/') &&
      (href.length > 96 || href.includes('%7C') || href.includes('|'))
    ) {
      return <span className="whitespace-pre-wrap wrap-break-word text-[var(--foreground)]">{children}</span>
    }

    if (typeof href === 'string' && href.startsWith('/app/')) {
      return (
        <a href={href} className="text-[#2563eb] underline underline-offset-2 font-medium hover:text-[#1d4ed8]">
          {children}
        </a>
      )
    }

    if (!safeExternalHref) return <span>{children}</span>

    return (
      <a href={safeExternalHref} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  code({ className, children }: any) {
    const match = /language-(\w+)/.exec(className || '')
    // Block code = has a language class from the fence
    if (match) {
      return (
        <CodeBlock language={match[1]}>
          {String(children).replace(/\n$/, '')}
        </CodeBlock>
      )
    }
    return <code className={className}>{children}</code>
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table({ children }: any) {
    return (
      <div className="table-wrapper">
        <table>{children}</table>
      </div>
    )
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  td({ children }: any) {
    return <td className="align-top [&_p:last-child]:mb-0 [&_ul:last-child]:mb-0 [&_ol:last-child]:mb-0">{children}</td>
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  th({ children }: any) {
    return <th className="align-top">{children}</th>
  },
}

const markdownRemarkPlugins = [remarkGfm, remarkMath]

/** `strict: 'ignore'` avoids some first-pass KaTeX failures on valid AMS math. */
const rehypeKatexSafe: Pluggable = [rehypeKatex, { strict: 'ignore' } as const]

const markdownRehypePlugins: Pluggable[] = [
  rehypeRaw,
  [rehypeSanitize, mdSanitizeSchema] as Pluggable,
  rehypeKatexSafe,
]

/**
 * Reveal `targetText` one character at a time at a steady rate so tokens that
 * arrive from the server in chunks of 5-20 chars get visually dripped in as
 * individual characters instead of popping in as blocks.
 *
 * Base rate is ~80 chars/sec; if we fall behind, the rate ramps up. When the backlog
 * is very large, the cap is raised so we take fewer frames to catch up (fewer React
 * markdown passes). When `isStreaming` flips to false (or `enabled` is false), we snap
 * to the full text immediately.
 */
function useSmoothStreamedText(
  targetText: string,
  isStreaming: boolean,
  enabled: boolean,
): string {
  const [display, setDisplay] = useState(() => (isStreaming && enabled ? '' : targetText))
  const targetRef = useRef(targetText)
  const displayRef = useRef(display)

  useLayoutEffect(() => {
    targetRef.current = targetText
    displayRef.current = display
  }, [targetText, display])

  useEffect(() => {
    if (!enabled || !isStreaming) {
      if (displayRef.current !== targetRef.current) {
        displayRef.current = targetRef.current
        setDisplay(targetRef.current)
      }
      return
    }

    let rafId: number | null = null
    let lastTs = 0

    const tick = (now: number) => {
      const target = targetRef.current
      let cur = displayRef.current

      // If upstream rewrote earlier text (rare — e.g., shim behavior), snap forward
      // so we don't get stuck trying to grow a prefix that no longer matches.
      if (!target.startsWith(cur)) {
        cur = target.slice(0, Math.min(cur.length, target.length))
        displayRef.current = cur
        setDisplay(cur)
      }

      if (cur.length < target.length) {
        const dt = lastTs ? now - lastTs : 16
        const backlog = target.length - cur.length
        // Higher ceiling when far behind → fewer intermediate states / fewer React updates.
        const maxRate = backlog > 1200 ? 1400 : 600
        const charsPerSec = Math.min(maxRate, 80 + backlog * 4)
        let charsToAdd = Math.max(1, Math.round((dt / 1000) * charsPerSec))
        if (backlog > 2500) {
          charsToAdd = Math.max(charsToAdd, Math.min(backlog, Math.ceil(backlog * 0.12)))
        }
        const nextLen = Math.min(target.length, cur.length + charsToAdd)
        const next = target.slice(0, nextLen)
        displayRef.current = next
        setDisplay(next)
      }

      lastTs = now
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId)
    }
  }, [isStreaming, enabled])

  return display
}

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
}

export function MarkdownMessage({
  text,
  isStreaming,
  sourceCitations,
  webSources,
  suppressTypingIndicator = false,
}: Props) {
  const hasCitationMap = !!(sourceCitations && Object.keys(sourceCitations).length > 0)
  const hasWebSources = !!(webSources && webSources.length > 0)
  // Defense in depth: every assistant markdown path (including any stream shape) strips NIM
  // preambles and instruction echoes before GFM + citation post-processing.
  const assistantStripped = useMemo(
    () => stripThinkingPlaceholderMarkdown(normalizeAgentAssistantText(text)),
    [text],
  )
  const normalizedDisplay = useMemo(
    () =>
      normalizeGeneratedMarkdown(assistantStripped, {
        sourceCitations,
        linkifyCitations: !isStreaming && hasCitationMap,
        webSources,
        // Linkify web citations even while streaming so inline chips render with the text,
        // instead of appearing only after completion.
        linkifyWebCitations: hasWebSources,
      }),
    [assistantStripped, sourceCitations, isStreaming, hasCitationMap, webSources, hasWebSources],
  )

  const mdRenderComponents = useMemo(
    () => {
      const chipClass =
        'overlay-webcite-chip mx-0.5 inline-flex max-w-full cursor-pointer items-baseline rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-0.5 align-baseline text-[11px] font-normal leading-none text-[var(--muted)] no-underline! transition-colors hover:bg-[var(--surface-elevated)] hover:text-[var(--foreground)]'

      const renderChip = (href: string, label: string, tooltipSources: WebSourceItem[]) => {
        const safeHref = safeHttpUrl(href)
        if (!safeHref) return <span className={chipClass}>{label}</span>
        return (
        <WebSourceTooltip sources={tooltipSources.filter((source) => safeHttpUrl(source.url))}>
          <a href={safeHref} target="_blank" rel="noopener noreferrer" className={chipClass}>
            {label}
          </a>
        </WebSourceTooltip>
        )
      }

      return {
        ...baseMdComponents,
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
            const safeHref = safeHttpUrl(href)
            if (!safeHref) return baseMdComponents.a(props)
            const matched = webSources?.find((s) => s.url === safeHref)
            const fallback: WebSourceItem = matched ?? {
              url: safeHref,
              title: '',
              origin: 'web-search',
            }
            const isTextJustUrl =
              !linkText || linkText === href || /^https?:\/\//i.test(linkText)
            const chipLabel = isTextJustUrl ? webSourceDisplayKey(safeHref) : linkText
            return renderChip(safeHref, chipLabel, [fallback])
          }

          return baseMdComponents.a(props)
        },
      }
    },
    [webSources],
  )
  // Smooth pacer: while streaming, reveal the normalized text one character at a time.
  // When not streaming, this returns `normalizedDisplay` immediately.
  const pacedDisplay = useSmoothStreamedText(normalizedDisplay, isStreaming, true)

  // Render the entire shimmed document in one pass so React can reconcile stable nodes
  // and only the tail paragraph/row/code-line actually re-renders. Append the streaming
  // marker inline so the Overlay logo sits at the right side of the most recent token.
  const tokenDisplay = useMemo(() => {
    if (!isStreaming) return normalizedDisplay
    return shimIncompleteMarkdown(pacedDisplay)
  }, [normalizedDisplay, pacedDisplay, isStreaming])

  // While streaming, deprioritize markdown reconciliation so input stays responsive.
  // On completion, render the synchronous string so the final pass is immediate.
  const deferredStreamMarkdown = useDeferredValue(tokenDisplay)
  const markdownChildren = isStreaming ? deferredStreamMarkdown : tokenDisplay

  if (!normalizedDisplay.trim() && !isStreaming) {
    return null
  }

  return (
    <div className={`markdown-content${isStreaming ? ' markdown-content--streaming' : ''}`}>
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        components={mdRenderComponents}
      >
        {markdownChildren}
      </ReactMarkdown>
      {isStreaming && !suppressTypingIndicator ? (
        <span className="overlay-stream-marker" aria-hidden="true" />
      ) : null}
    </div>
  )
}
