import 'server-only'

import type { SlackChannel, SlackMessage, SlackUser } from './composioClient'

/**
 * Canonical intermediate representation for a Slack channel
 * mapped to an Overlay conversation.
 */
export interface NormalizedChannel {
  sourceChannelId: string
  sourceName: string
  sourceType: 'public_channel' | 'private_channel' | 'im' | 'mpim'
  isPrivate: boolean
  memberCount: number
  // Overlay conversation fields
  title: string
  // For DMs: the other user's display name. For channels: the channel name.
  // Used as the conversation title in Overlay.
  clientId: string  // dedup key: `slack:{workspaceId}:{channelId}`
}

/**
 * Canonical intermediate representation for a Slack message
 * mapped to an Overlay conversation message.
 */
export interface NormalizedMessage {
  sourceMessageTs: string
  sourceUserId: string
  sourceUserName: string
  sourceUserEmail: string | null
  text: string
  threadTs: string | null  // null = not a thread message; set = this is a reply in this thread
  isThreadParent: boolean  // true = this message started a thread
  replyCount: number
  files: Array<{
    sourceFileId: string
    filename: string
    mimeType: string
    size: number
  }>
  reactions: Array<{
    emoji: string
    userIds: string[]
  }>
  createdAt: number  // epoch ms, derived from Slack ts
  editedAt: number | null
  subtype: string | null  // e.g. "channel_join", "channel_leave"
  // Overlay message fields
  role: 'user' | 'assistant'
  turnId: string  // = sourceMessageTs (unique per message)
  content: string  // = formatted text with author prefix and file links
}

function normalizeIdentityText(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') || ''
}

/**
 * User cache for resolving Slack user IDs to display names.
 */
export class SlackUserCache {
  private users = new Map<string, SlackUser>()

  load(users: SlackUser[]): void {
    for (const u of users) {
      this.users.set(u.id, u)
    }
  }

  resolveName(userId: string): string {
    const user = this.users.get(userId)
    if (!user) return userId
    return user.real_name || user.profile?.display_name || user.name || userId
  }

  resolveEmail(userId: string): string | null {
    const email = this.users.get(userId)?.profile?.email?.trim().toLowerCase()
    return email || null
  }

  /**
   * Resolve the Slack user ID for the authenticated importer. Slack profile
   * emails are not guaranteed to match the Overlay account email, so use a
   * unique normalized display-name match as a fallback.
   */
  findUserIdByIdentity({
    email,
    displayName,
  }: {
    email?: string | null
    displayName?: string | null
  }): string | null {
    const users = [...this.users.values()].filter((user) => !user.is_bot && !user.deleted)
    const normalizedEmail = email?.trim().toLowerCase()
    if (normalizedEmail) {
      const emailMatches = users.filter((user) => user.profile?.email?.trim().toLowerCase() === normalizedEmail)
      if (emailMatches.length === 1) return emailMatches[0]!.id
    }

    const normalizedName = normalizeIdentityText(displayName)
    if (!normalizedName) return null
    const nameMatches = users.filter((user) => [user.real_name, user.profile?.display_name, user.name]
      .some((candidate) => normalizeIdentityText(candidate) === normalizedName))
    return nameMatches.length === 1 ? nameMatches[0]!.id : null
  }

  isBot(userId: string): boolean {
    return this.users.get(userId)?.is_bot ?? false
  }

  /** All non-empty, normalized emails across cached (human) users. */
  allEmails(): string[] {
    const emails = new Set<string>()
    for (const user of this.users.values()) {
      if (user.is_bot || user.deleted) continue
      const email = user.profile?.email?.trim().toLowerCase()
      if (email) emails.add(email)
    }
    return [...emails]
  }
}

function tsToMillis(ts: string): number {
  // Slack timestamps are "seconds.microseconds" as a string
  const parts = ts.split('.')
  const seconds = parseInt(parts[0] ?? '0', 10)
  const micros = parseInt((parts[1] ?? '0').padEnd(6, '0').slice(0, 6), 10)
  return seconds * 1000 + Math.floor(micros / 1000)
}

function classifyChannel(ch: SlackChannel): NormalizedChannel['sourceType'] {
  if (ch.is_mpim) return 'mpim'
  if (ch.is_im) return 'im'
  if (ch.is_private || ch.is_group) return 'private_channel'
  return 'public_channel'
}

/**
 * Normalize a Slack channel to an Overlay conversation descriptor.
 */
export function normalizeChannel(
  ch: SlackChannel,
  workspaceId: string,
  userCache: SlackUserCache,
): NormalizedChannel {
  const sourceType = classifyChannel(ch)
  const sourceName = ch.name || ''
  // A short, stable suffix keeps generated titles unique per channel so two
  // otherwise-identically-named conversations don't collide on their slug.
  const shortId = ch.id.slice(-4)

  // For DMs, the channel name is often empty. Try to resolve the other user.
  let title: string
  if (sourceType === 'im') {
    // 1:1 DMs have no name — title them with the other participant's name.
    const other = ch.user ? userCache.resolveName(ch.user) : ''
    title = other && other !== ch.user ? other : `Direct message ${shortId}`
  } else if (sourceType === 'mpim') {
    // MPIMs have names like "mpdm-user1--user2--user3-1".
    title = sourceName || `Group DM ${shortId}`
  } else {
    // Store the bare channel name. The channel list and room header render
    // their own `#` prefix, so keeping it here would double it up ("##social").
    title = sourceName
  }

  return {
    sourceChannelId: ch.id,
    sourceName,
    sourceType,
    isPrivate: ch.is_private ?? false,
    memberCount: ch.num_members ?? 0,
    title,
    clientId: `slack:${workspaceId}:${ch.id}`,
  }
}

/**
 * Format a Slack message's text for Overlay.
 * Replaces Slack user mentions (<@U123>) with display names.
 * Appends file info if present.
 */
function formatMessageText(
  msg: SlackMessage,
  userCache: SlackUserCache,
): string {
  let text = msg.text || ''

  // Replace user mentions: <@U123ABC> → @Display Name
  text = text.replace(/<@([UW][A-Z0-9]+)>/g, (match, userId) => {
    const name = userCache.resolveName(userId)
    return `@${name}`
  })

  // Replace channel mentions: <#C123|general> → #general
  text = text.replace(/<#([CG][A-Z0-9]+)\|([^>]+)>/g, '#$2')

  // Append file references
  if (msg.files && msg.files.length > 0) {
    const fileList = msg.files
      .map((f) => `[File: ${f.name || f.id}]`)
      .join(' ')
    text = text ? `${text}\n\n${fileList}` : fileList
  }

  return text
}

/**
 * Normalize a Slack message to an Overlay conversation message.
 */
export function normalizeMessage(
  msg: SlackMessage,
  userCache: SlackUserCache,
): NormalizedMessage {
  const sourceUserId = msg.user || msg.username || 'unknown'
  const sourceUserName = msg.user ? userCache.resolveName(msg.user) : (msg.username || 'unknown')
  const sourceUserEmail = msg.user ? userCache.resolveEmail(msg.user) : null

  // Skip system messages (joins, leaves, etc.) — we'll still import them but
  // mark them with a clear prefix so they're distinguishable
  const subtype = msg.subtype ?? null
  let text = formatMessageText(msg, userCache)

  if (subtype && subtype !== 'file_share') {
    text = `_${subtype}: ${text}_`
  }

  // Determine thread info
  const threadTs = msg.thread_ts ?? null
  const isThreadParent = threadTs !== null && threadTs === msg.ts

  // In Overlay, all imported Slack messages are "user" role.
  // Bot messages from Slack (like the Composio bot) are also "user" role
  // since they're historical imports, not Overlay agent responses.
  const role: 'user' | 'assistant' = 'user'

  // Turn ID = Slack ts (globally unique per message in a workspace)
  const turnId = msg.ts

  // The author is carried as structured metadata (see importedAuthor* on the
  // stored message), so the body is the plain message text — no "[Name]" prefix.
  const content = text

  return {
    sourceMessageTs: msg.ts,
    sourceUserId,
    sourceUserName,
    sourceUserEmail,
    text,
    threadTs: isThreadParent ? null : threadTs,
    isThreadParent,
    replyCount: msg.reply_count ?? 0,
    files: (msg.files ?? []).map((f) => ({
      sourceFileId: f.id,
      filename: f.name || f.id,
      mimeType: f.mimetype || f.filetype || 'application/octet-stream',
      size: f.size ?? 0,
    })),
    reactions: (msg.reactions ?? []).map((r) => ({
      emoji: r.name,
      userIds: r.users ?? [],
    })),
    createdAt: tsToMillis(msg.ts),
    editedAt: msg.edited ? tsToMillis(msg.edited.ts) : null,
    subtype,
    role,
    turnId,
    content,
  }
}

/**
 * Check if a message should be skipped entirely (e.g. pure system messages
 * that add no value to the imported conversation).
 */
export function shouldSkipMessage(msg: SlackMessage): boolean {
  // Skip messages that are only channel join/leave notices
  if (msg.subtype === 'channel_join' || msg.subtype === 'channel_leave') {
    return true
  }
  // Skip messages with no text and no files
  if (!msg.text && !msg.files?.length && !msg.subtype) {
    return true
  }
  return false
}
