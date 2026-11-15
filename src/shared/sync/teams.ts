import type { SyncChannelKind } from './types'

/**
 * Pause reasons for Teams links that need Overlay added in Teams. The settings
 * page shows them as the fix, and the maintenance tick retries links paused
 * with one of them, so re-adding the app resumes sync on its own.
 */
export const TEAMS_APP_MISSING_REASONS: Record<SyncChannelKind, string> = {
  public: 'Add Overlay to this team in Teams to resume.',
  private: 'Add Overlay to this private channel in Teams to resume.',
  shared: 'Add Overlay to this shared channel in Teams to resume.',
}

export function isTeamsAppMissingReason(reason: string | undefined): boolean {
  return Object.values(TEAMS_APP_MISSING_REASONS).includes(reason ?? '')
}

/** Teams reply ids are only unique beside their root, so replies are keyed as `root/reply`. */
export function teamsMessageKey(messageId: string, replyToId?: string | null): string {
  return replyToId && replyToId !== messageId ? replyToId + '/' + messageId : messageId
}

export function parseTeamsMessageKey(key: string): { messageId: string; rootId?: string } {
  const [rootId, replyId] = key.split('/')
  return replyId ? { messageId: replyId, rootId } : { messageId: key }
}
