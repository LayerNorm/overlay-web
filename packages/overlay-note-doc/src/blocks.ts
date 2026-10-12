/**
 * Overlay custom block/inline specs (headless variants).
 *
 * These carry the schema (prop names, defaults) plus DOM-only parse/render
 * used by server and test conversions. The React counterparts in
 * `@overlay/modules-react` reuse these configs so `docJson` stays identical
 * across renderers.
 */

import {
  createBlockSpec,
  createInlineContentSpec,
  defaultProps,
  type CustomInlineContentConfig,
} from '@blocknote/core'

/* ------------------------------------------------------------------ */
/* Callout                                                             */
/* ------------------------------------------------------------------ */

export const CALLOUT_ICONS = ['info', 'warning', 'tip', 'note'] as const
export type CalloutIcon = (typeof CALLOUT_ICONS)[number]

export const calloutBlockConfig = {
  type: 'callout' as const,
  propSchema: {
    ...defaultProps,
    icon: { default: 'note' as CalloutIcon },
  },
  content: 'inline' as const,
}

export const CALLOUT_SELECTOR = 'div[data-callout]'

/** `> [!NOTE]` GFM alert markers -> our callout icon prop. */
const ALERT_TO_ICON: Record<string, CalloutIcon> = {
  note: 'note',
  tip: 'tip',
  important: 'warning',
  warning: 'warning',
  caution: 'warning',
  info: 'info',
}

export function iconForAlertTag(tag: string): CalloutIcon {
  return ALERT_TO_ICON[tag.trim().toLowerCase()] ?? 'note'
}

export function alertTagForIcon(icon: string): string {
  const entry = Object.entries(ALERT_TO_ICON).find(([, v]) => v === icon)
  return (entry?.[0] ?? 'note').toUpperCase()
}

export const createCalloutSpecHeadless = () =>
  createBlockSpec(calloutBlockConfig, {
    parse: (element) => {
      if (element.tagName !== 'DIV') return
      if (!element.hasAttribute('data-callout')) return
      const icon = element.getAttribute('data-callout-icon')
      return {
        icon: CALLOUT_ICONS.includes(icon as CalloutIcon)
          ? (icon as CalloutIcon)
          : undefined,
      }
    },
    render: (block) => {
      const div = document.createElement('div')
      div.className = 'bn-callout'
      div.setAttribute('data-callout', '')
      const icon = (block.props as { icon?: string }).icon ?? 'note'
      div.setAttribute('data-callout-icon', icon)
      return { dom: div }
    },
    toExternalHTML: (block) => {
      // GFM alert: `> [!NOTE] content` keeps exports readable for agents/GitHub.
      const quote = document.createElement('blockquote')
      const marker = document.createElement('p')
      marker.textContent = `[!${alertTagForIcon(
        (block.props as { icon?: string }).icon ?? 'note',
      )}]`
      quote.appendChild(marker)
      const content = document.createElement('p')
      return { dom: quote, contentDOM: content }
    },
  })

/* ------------------------------------------------------------------ */
/* Embed                                                               */
/* ------------------------------------------------------------------ */

export const embedBlockConfig = {
  type: 'embed' as const,
  propSchema: {
    ...defaultProps,
    url: { default: '' },
    caption: { default: '' },
  },
  content: 'none' as const,
}

const YOUTUBE_HOSTS = /^(www\.)?(youtube\.com|youtube-nocookie\.com|youtu\.be)$/

export function embeddableUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return null
    const host = parsed.hostname
    if (!YOUTUBE_HOSTS.test(host)) return null
    if (host.endsWith('youtu.be')) {
      const id = parsed.pathname.replace(/^\//, '').split('/')[0]
      return id ? `https://www.youtube.com/embed/${id}` : null
    }
    if (parsed.pathname.startsWith('/embed/')) return url
    const id = parsed.searchParams.get('v')
    if (parsed.pathname === '/watch' && id)
      return `https://www.youtube.com/embed/${id}`
    const shorts = /^\/shorts\/([^/?]+)/.exec(parsed.pathname)
    if (shorts) return `https://www.youtube.com/embed/${shorts[1]}`
    return null
  } catch {
    return null
  }
}

export const createEmbedSpecHeadless = () =>
  createBlockSpec(embedBlockConfig, {
    meta: { isolating: true, selectable: true },
    parse: (element) => {
      const isEmbedFigure =
        element.tagName === 'FIGURE' &&
        element.hasAttribute('data-embed-url')
      if (!isEmbedFigure) return
      return {
        url: element.getAttribute('data-embed-url') ?? '',
      }
    },
    render: (block) => {
      const figure = document.createElement('figure')
      figure.className = 'bn-embed'
      const url = (block.props as { url?: string }).url ?? ''
      figure.setAttribute('data-embed-url', url)
      return { dom: figure }
    },
    toExternalHTML: (block) => {
      const url = (block.props as { url?: string }).url ?? ''
      const caption = (block.props as { caption?: string }).caption ?? ''
      const figure = document.createElement('figure')
      figure.setAttribute('data-embed-url', url)
      const link = document.createElement('a')
      link.href = url
      link.textContent = caption || url
      figure.appendChild(link)
      return { dom: figure }
    },
  })

/* ------------------------------------------------------------------ */
/* Mention (inline content)                                            */
/* ------------------------------------------------------------------ */

export type MentionKind =
  | 'file'
  | 'connector'
  | 'automation'
  | 'skill'
  | 'mcp'
  | 'chat'
  | 'person'

export const mentionInlineConfig = {
  type: 'mention' as const,
  propSchema: {
    mentionType: { default: 'file' as MentionKind },
    mentionId: { default: '' },
    label: { default: '' },
  },
  content: 'none' as const,
} satisfies CustomInlineContentConfig

export const MENTION_SCHEME = 'overlay://'
export const MENTION_SELECTOR = 'a[data-mention][href^="overlay://"]'

export function mentionHref(type: string, id: string): string {
  return `${MENTION_SCHEME}${type}/${id}`
}

export function parseMentionHref(href: string): {
  type: MentionKind
  id: string
} | null {
  if (!href.startsWith(MENTION_SCHEME)) return null
  const rest = href.slice(MENTION_SCHEME.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return null
  const type = rest.slice(0, slash) as MentionKind
  const id = rest.slice(slash + 1)
  return id ? { type, id } : null
}

export const createMentionSpecHeadless = () =>
  createInlineContentSpec(mentionInlineConfig, {
    parse: (element) => {
      if (element.tagName !== 'A') return
      const parsed = parseMentionHref(element.getAttribute('href') ?? '')
      if (!parsed) return
      return {
        mentionType: parsed.type,
        mentionId: parsed.id,
        label: element.textContent?.replace(/^@/, '') ?? parsed.id,
      }
    },
    render: (inlineContent) => {
      const span = document.createElement('span')
      span.className = 'bn-mention'
      span.textContent = `@${
        (inlineContent.props as { label?: string }).label ?? ''
      }`
      return { dom: span }
    },
    toExternalHTML: (inlineContent) => {
      const props = inlineContent.props as {
        mentionType?: string
        mentionId?: string
        label?: string
      }
      const anchor = document.createElement('a')
      anchor.setAttribute('data-mention', '')
      anchor.href = mentionHref(props.mentionType ?? '', props.mentionId ?? '')
      anchor.textContent = `@${props.label ?? ''}`
      return { dom: anchor }
    },
  })
