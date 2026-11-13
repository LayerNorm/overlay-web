import 'server-only'

import type { SyncExternalAuthor, SyncInboundEvent, SyncProvider } from '@/shared/sync/types'

/**
 * Contracts each provider implements (Slack in src/server/sync/slack/, Teams in
 * src/server/sync/teams/). The shared history worker and outbound worker call
 * these and never touch platform APIs directly.
 */

export type SyncLinkRef = {
  linkId: string
  workspaceId: string
  provider: SyncProvider
  externalOrgId: string
  externalChannelId: string
  externalGroupId?: string
  conversationId: string
}

export type SyncHistoryPage = {
  /** Converted events, ready for sync/ingest:applyInbound. */
  events: SyncInboundEvent[]
  authors: SyncExternalAuthor[]
  nextCursor?: string
  /** Oldest message time (ms) in this page, for progress. */
  oldestAt?: number
  /** True once the page reached the link's history target or the start of the channel. */
  done: boolean
}

export interface SyncHistoryAdapter {
  provider: SyncProvider
  /**
   * Fetches one page, newest first, stopping at targetAt. The cursor is the
   * adapter's own and must carry targetAt once started. Calls draw from the
   * shared rate budget at the given priority (history unless repairing).
   * Throws SyncRateLimitedError when the platform says to wait.
   */
  fetchHistoryPage(link: SyncLinkRef, args: { cursor?: string; targetAt: number; priority?: 'history' | 'repair' }): Promise<SyncHistoryPage>
}

/** A member's own platform grant, unsealed only inside the outbound worker. */
export type SyncMemberCredential = {
  externalUserId: string
  accessToken: string
}

export type SyncOutboundMessage = {
  /** Markdown as stored in Overlay. */
  content: string
  /** Platform id of the thread root when replying in a thread. */
  externalThreadId?: string
}

export interface SyncOutboundAdapter {
  provider: SyncProvider
  post(link: SyncLinkRef, credential: SyncMemberCredential, message: SyncOutboundMessage): Promise<{ externalMessageId: string }>
  edit(link: SyncLinkRef, credential: SyncMemberCredential, externalMessageId: string, message: SyncOutboundMessage): Promise<void>
  remove(link: SyncLinkRef, credential: SyncMemberCredential, externalMessageId: string): Promise<void>
  react(link: SyncLinkRef, credential: SyncMemberCredential, externalMessageId: string, emoji: string, enabled: boolean): Promise<void>
}

/** The platform asked us to slow down; retry after the given delay. */
export class SyncRateLimitedError extends Error {
  constructor(readonly retryAfterMs: number, message = 'Rate limited by the platform') {
    super(message)
  }
}

/** The member's own grant no longer works (revoked, deactivated); they must reconnect. */
export class SyncAccountRevokedError extends Error {}

/** The platform refused this change for good (not in channel, message too old to edit); retrying cannot help. */
export class SyncOutboundRejectedError extends Error {}

/** The link can't sync until someone acts (app removed from the channel, install revoked). */
export class SyncLinkPausedError extends Error {
  constructor(readonly reason: string) {
    super(reason)
  }
}
