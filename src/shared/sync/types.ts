/**
 * Provider-neutral shapes for Slack and Teams channel sync
 * (internal/plans/SLACK_TEAMS_SYNC_PLAN.md). Adapters normalize platform
 * payloads into these before anything reaches Convex.
 */

export type SyncProvider = 'slack' | 'teams'

export type SyncChannelKind = 'public' | 'private' | 'shared'

export type SyncLinkStatus = 'syncing' | 'history' | 'catching_up' | 'paused'

export type SyncExternalAuthor = {
  externalUserId: string
  displayName: string
  email?: string
  avatarUrl?: string
  isBot?: boolean
}

/** One change in a linked channel. Timestamps are epoch milliseconds. */
export type SyncInboundEvent =
  | {
      kind: 'message.upsert'
      externalMessageId: string
      /** Platform id of the thread root when this is a reply. */
      externalThreadId?: string
      externalUserId: string
      /** Markdown, already converted from the platform's format. */
      text: string
      createdAt: number
      editedAt?: number
    }
  | { kind: 'message.delete'; externalMessageId: string }
  | {
      kind: 'reaction.add' | 'reaction.remove'
      externalMessageId: string
      externalUserId: string
      emoji: string
    }

export type SyncInboundBatch = {
  provider: SyncProvider
  externalOrgId: string
  externalChannelId: string
  events: SyncInboundEvent[]
  authors: SyncExternalAuthor[]
}

/** History pages may cover at most this far back. */
export const SYNC_HISTORY_WINDOW_MS = 180 * 24 * 60 * 60 * 1000

export function syncTurnId(provider: SyncProvider, externalChannelId: string, externalMessageId: string): string {
  return 'sync:' + provider + ':' + externalChannelId + ':' + externalMessageId
}

/** Reactions by external people who are not Overlay members are keyed by this pseudo principal. */
export function syncExternalPrincipalId(provider: SyncProvider, externalUserId: string): string {
  return 'ext:' + provider + ':' + externalUserId
}
