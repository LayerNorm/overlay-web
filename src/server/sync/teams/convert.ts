import 'server-only'

import type { Element, ElementContent } from 'hast'
import { fromHtml } from 'hast-util-from-html'
import { toHtml } from 'hast-util-to-html'
import { toMdast } from 'hast-util-to-mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm'
import { toHast } from 'mdast-util-to-hast'
import { toMarkdown } from 'mdast-util-to-markdown'
import { gfm } from 'micromark-extension-gfm'
import { teamsMessageKey } from '@/shared/sync/teams'
import type { SyncExternalAuthor, SyncInboundEvent } from '@/shared/sync/types'

type TeamsIdentity = { id?: string | null; displayName?: string | null; userIdentityType?: string | null }

/** The parts of a Graph chatMessage that sync reads. */
export type TeamsChatMessage = {
  id: string
  replyToId?: string | null
  messageType?: string
  createdDateTime?: string
  lastModifiedDateTime?: string | null
  lastEditedDateTime?: string | null
  deletedDateTime?: string | null
  subject?: string | null
  from?: { user?: TeamsIdentity | null; application?: TeamsIdentity | null } | null
  body?: { contentType?: string; content?: string | null }
  reactions?: Array<{ reactionType?: string; displayName?: string | null; user?: { user?: TeamsIdentity | null; application?: TeamsIdentity | null } | null }>
  replies?: TeamsChatMessage[]
  'replies@odata.nextLink'?: string
}

const LEGACY_REACTIONS: Record<string, string> = {
  like: '👍',
  heart: '❤️',
  laugh: '😆',
  surprised: '😮',
  sad: '😢',
  angry: '😠',
}

/** Teams reactions are a legacy name (like, heart), the emoji itself (since 2024), or 'custom' with the custom emoji's name. */
export function teamsReactionToEmoji(reactionType: string, displayName?: string | null): string {
  const legacy = LEGACY_REACTIONS[reactionType.toLowerCase()]
  if (legacy) return legacy
  if (reactionType === 'custom') return ':' + (displayName || 'custom') + ':'
  return /^[a-z0-9_+-]+$/i.test(reactionType) ? ':' + reactionType + ':' : reactionType
}

function textOf(node: ElementContent): string {
  if (node.type === 'text') return node.value
  return node.type === 'element' ? node.children.map(textOf).join('') : ''
}

/**
 * Converts a Teams message body to Overlay markdown: <at> mentions become
 * @name, <emoji> becomes its character, custom emoji become :name:, inline images become a placeholder
 * until attachments sync (Phase 6), and formatting and links carry over.
 */
export function teamsHtmlToMarkdown(html: string): string {
  const tree = fromHtml(html, { fragment: true })
  const mdast = toMdast(tree, {
    handlers: {
      at: (_state, node: Element) => ({ type: 'text', value: '@' + node.children.map(textOf).join('').trim() }),
      emoji: (_state, node: Element) => ({ type: 'text', value: String(node.properties.alt ?? node.properties.title ?? '') }),
      customemoji: (_state, node: Element) => ({ type: 'text', value: ':' + String(node.properties.alt ?? 'emoji') + ':' }),
      img: () => ({ type: 'text', value: '(image)' }),
      attachment: () => undefined,
    },
  })
  return toMarkdown(mdast, { bullet: '-', extensions: [gfmToMarkdown()] }).replace(/\u00a0/g, ' ').trim()
}

/** Converts Overlay markdown to the HTML body Graph expects when posting. Raw HTML in the markdown is dropped. */
export function markdownToTeamsHtml(markdown: string): string {
  const mdast = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  return toHtml(toHast(mdast))
}

function identityOf(from: TeamsChatMessage['from']): SyncExternalAuthor | null {
  const person = from?.user ?? from?.application
  if (!person?.id) return null
  return {
    externalUserId: person.id,
    displayName: person.displayName || (from?.user ? 'Teams user' : 'Teams app'),
    ...(from?.user ? {} : { isBot: true }),
  }
}

function time(value: string | null | undefined): number | undefined {
  const parsed = value ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Reduces one Graph chatMessage (a channel post or a reply) to sync events: a
 * delete for removed messages, otherwise an upsert followed by one
 * reaction.add per current reaction. Reaction removals need the stored state
 * and are added by the caller. System event messages produce nothing.
 */
export function teamsMessageToEvents(message: TeamsChatMessage): { events: SyncInboundEvent[]; authors: SyncExternalAuthor[] } {
  const externalMessageId = teamsMessageKey(message.id, message.replyToId)
  if (message.deletedDateTime) return { events: [{ kind: 'message.delete', externalMessageId }], authors: [] }
  const author = identityOf(message.from)
  const createdAt = time(message.createdDateTime)
  if (message.messageType && message.messageType !== 'message') return { events: [], authors: [] }
  if (!author || createdAt === undefined) return { events: [], authors: [] }
  const content = message.body?.content ?? ''
  const body = message.body?.contentType === 'html' ? teamsHtmlToMarkdown(content) : content.trim()
  const text = message.subject?.trim() ? '**' + message.subject.trim() + '**' + (body ? '\n\n' + body : '') : body
  const editedAt = time(message.lastEditedDateTime)
  const events: SyncInboundEvent[] = [{
    kind: 'message.upsert',
    externalMessageId,
    ...(message.replyToId && message.replyToId !== message.id ? { externalThreadId: message.replyToId } : {}),
    externalUserId: author.externalUserId,
    text,
    createdAt,
    ...(editedAt !== undefined ? { editedAt } : {}),
  }]
  const authors = new Map([[author.externalUserId, author]])
  for (const reaction of message.reactions ?? []) {
    const reactor = identityOf(reaction.user)
    if (!reactor || !reaction.reactionType) continue
    events.push({ kind: 'reaction.add', externalMessageId, externalUserId: reactor.externalUserId, emoji: teamsReactionToEmoji(reaction.reactionType, reaction.displayName) })
    if (!authors.has(reactor.externalUserId)) authors.set(reactor.externalUserId, reactor)
  }
  return { events, authors: [...authors.values()] }
}
