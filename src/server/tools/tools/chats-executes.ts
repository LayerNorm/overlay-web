import 'server-only'

import { callInternalApiGet } from './internal-api'
import type { OverlayToolsOptions } from './types'

/**
 * Chat reading for agents: find a chat by title and read its messages, through the same
 * `/api/v1/conversations` routes (and access rules) the app uses. Read only.
 */

const CONVERSATIONS_PATH = '/api/v1/conversations'
const DEFAULT_LIST_LIMIT = 20
const MAX_LIST_LIMIT = 50
const MAX_LIST_PAGES = 5
const DEFAULT_MESSAGE_LIMIT = 40
const MAX_MESSAGE_LIMIT = 100
/** Keeps one read from flooding the model's context; the newest messages are kept. */
const MAX_TRANSCRIPT_CHARS = 30_000

type ConversationRow = {
  _id?: string
  id?: string
  title?: string
  conversationType?: string
  updatedAt?: number
  lastModified?: number
}

type MessagePart = { type?: string; text?: string; fileName?: string }
type MessageRow = {
  id: string
  role?: string
  authorKind?: string
  authorPrincipalId?: string
  importedAuthorName?: string
  createdAt: number
  parts?: MessagePart[]
}

async function get(options: OverlayToolsOptions, pathWithQuery: string): Promise<Response> {
  return await callInternalApiGet(
    pathWithQuery,
    options.accessToken,
    options.baseUrl,
    options.forwardCookie,
    options.serverSecret,
    options.userId,
    options.workspaceId,
  )
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch((_error) => null) as { error?: string } | null
  return body?.error ?? fallback
}

async function listConversations(options: OverlayToolsOptions): Promise<ConversationRow[] | { error: string }> {
  // `view=all` includes direct messages and channels as well as personal chats; the list is paged, newest first.
  const rows: ConversationRow[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const params = new URLSearchParams({ view: 'all', limit: '100', ...(cursor ? { cursor } : {}) })
    const res = await get(options, `${CONVERSATIONS_PATH}?${params}`)
    if (!res.ok) return { error: await errorMessage(res, 'Could not list chats') }
    const body = await res.json() as ConversationRow[] | { data?: ConversationRow[]; hasMore?: boolean; nextCursor?: string }
    if (Array.isArray(body)) return body
    rows.push(...(body.data ?? []))
    if (!body.hasMore || !body.nextCursor) break
    cursor = body.nextCursor
  }
  return rows
}

function chatIdOf(row: ConversationRow): string {
  return String(row._id ?? row.id ?? '')
}

function summarize(row: ConversationRow) {
  return {
    chatId: chatIdOf(row),
    title: row.title?.trim() || 'Untitled chat',
    type: row.conversationType ?? 'personal',
    updatedAt: row.updatedAt ?? row.lastModified ?? 0,
  }
}

export async function executeListChats(options: OverlayToolsOptions, input: { query?: string; limit?: number }) {
  try {
    const rows = await listConversations(options)
    if ('error' in rows) return { success: false, error: rows.error }
    const query = input.query?.trim().toLowerCase()
    const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(input.limit ?? DEFAULT_LIST_LIMIT)))
    const chats = rows
      .filter((row) => !query || (row.title ?? '').toLowerCase().includes(query))
      .map(summarize)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, limit)
    return {
      success: true,
      chats,
      ...(chats.length === 0 ? { note: query ? 'No chat title matches. Try a shorter phrase, or call list_chats without a query.' : 'There are no chats yet.' } : {}),
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Could not list chats' }
  }
}

function textOf(message: MessageRow): string {
  const text = (message.parts ?? [])
    .map((part) => (part.type === 'text' || part.type === 'output-text') && part.text ? part.text : part.type === 'file' && part.fileName ? `[file: ${part.fileName}]` : '')
    .filter(Boolean)
    .join('\n')
    .trim()
  return text
}

function speakerOf(message: MessageRow): string {
  if (message.importedAuthorName) return message.importedAuthorName
  if (message.authorKind === 'agent' || message.authorKind === 'model') return 'assistant'
  if (message.authorKind === 'system') return 'system'
  if (message.authorKind === 'human') return 'user'
  return message.role === 'assistant' ? 'assistant' : 'user'
}

export async function executeReadChat(
  options: OverlayToolsOptions,
  input: { chatId?: string; title?: string; limit?: number },
) {
  try {
    let chatId = input.chatId?.trim() ?? ''
    let title = ''
    if (!chatId) {
      const wanted = input.title?.trim().toLowerCase()
      if (!wanted) return { success: false, error: 'Give a chatId (from list_chats) or the chat\'s title.' }
      const rows = await listConversations(options)
      if ('error' in rows) return { success: false, error: rows.error }
      const exact = rows.filter((row) => (row.title ?? '').trim().toLowerCase() === wanted)
      const matches = exact.length ? exact : rows.filter((row) => (row.title ?? '').toLowerCase().includes(wanted))
      if (matches.length === 0) return { success: false, error: `No chat is titled "${input.title}". Call list_chats to see them.` }
      if (matches.length > 1) {
        return { success: false, error: 'More than one chat matches that title; pass the chatId of the one you mean.', candidates: matches.slice(0, 10).map(summarize) }
      }
      chatId = chatIdOf(matches[0]!)
      title = matches[0]!.title ?? ''
    }
    const limit = Math.min(MAX_MESSAGE_LIMIT, Math.max(1, Math.floor(input.limit ?? DEFAULT_MESSAGE_LIMIT)))
    const params = new URLSearchParams({ conversationId: chatId, messages: 'true', limit: String(limit), compactToolPayloads: 'true' })
    const res = await get(options, `${CONVERSATIONS_PATH}?${params}`)
    if (!res.ok) return { success: false, error: await errorMessage(res, 'Chat not found') }
    const data = await res.json() as { title?: string; messages?: MessageRow[]; hasMore?: boolean }
    const lines = (data.messages ?? [])
      .slice()
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((message) => ({ at: new Date(message.createdAt).toISOString(), from: speakerOf(message), text: textOf(message) }))
      .filter((message) => message.text)
    // Keep the newest messages that fit.
    let total = 0
    const kept: typeof lines = []
    for (const message of lines.slice().reverse()) {
      total += message.text.length
      if (total > MAX_TRANSCRIPT_CHARS && kept.length > 0) break
      kept.push(message)
    }
    kept.reverse()
    return {
      success: true,
      chatId,
      title: data.title ?? title,
      messages: kept,
      ...(kept.length < lines.length || data.hasMore
        ? { note: `Showing the latest ${kept.length} messages; earlier ones were left out. Pass a larger limit for more.` }
        : {}),
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Could not read the chat' }
  }
}
