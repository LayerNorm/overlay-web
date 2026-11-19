import type { SyncChannelKind, SyncLinkStatus, SyncProvider } from '@/shared/sync/types'

/** One provider's slice of the live `sync/links:status` query. */
export type SyncProviderStatus = {
  provider: SyncProvider
  connection: {
    externalOrgName: string
    status: 'connected' | 'paused' | 'disconnected'
    autoLink: boolean
    connectedAt: number
    connectedByName: string | null
  } | null
  account: { externalDisplayName: string | null; dmSyncEnabled: boolean } | null
  links: SyncLinkRow[]
}

export type SyncLinkRow = {
  linkId: string
  externalChannelId: string
  externalChannelName: string
  externalChannelKind: SyncChannelKind
  conversationId: string
  status: SyncLinkStatus
  pauseReason?: string
  historyTargetAt?: number
  historyOldestAt?: number
  catchUpUntil?: number
  createdAt: number
  overlayChannelName: string
  overlayChannelVisibility: 'public' | 'private'
}

export type SyncStatus = { canManage: boolean; providers: SyncProviderStatus[] }

/** A channel the workspace's install can see, from `GET /api/v1/sync/<provider>?action=channels`. */
export type SyncAvailableChannel = { id: string; name: string; kind: SyncChannelKind; groupId?: string; groupName?: string }

export type SyncLinkTarget = { conversationId: string; name: string; visibility: 'public' | 'private' }

export const SYNC_PROVIDERS: Record<SyncProvider, {
  name: string
  monogram: string
  accent: string
  orgLabel: string
  autoLabel: string
  autoHelp: string
}> = {
  slack: {
    name: 'Slack',
    monogram: 'S',
    accent: '#4A154B',
    orgLabel: 'Your Slack workspace',
    autoLabel: 'Auto-link new public channels',
    autoHelp: 'New public Slack channels sync to a new Overlay channel with the same name.',
  },
  teams: {
    name: 'Microsoft Teams',
    monogram: 'T',
    accent: '#4B53BC',
    orgLabel: 'Your Teams organization',
    autoLabel: 'Auto-link new standard channels',
    autoHelp: 'New standard channels in teams with Overlay installed sync to a new private Overlay channel.',
  },
}

const KIND_LABEL: Record<SyncChannelKind, string> = { public: 'Public', private: 'Private', shared: 'Shared' }

export function channelKindLabel(kind: SyncChannelKind, groupName?: string): string {
  return groupName ? groupName + ' · ' + KIND_LABEL[kind] : KIND_LABEL[kind]
}

/** Private and shared channels, and every Teams channel, may only sync into private Overlay channels. */
export function needsPrivateTarget(provider: SyncProvider, kind: SyncChannelKind): boolean {
  return provider === 'teams' || kind !== 'public'
}

/** Where the org-level connect, member connect and Teams app package live. */
export function syncUrls(provider: SyncProvider, returnTo: string, workspaceId: string) {
  const back = 'returnTo=' + encodeURIComponent(returnTo) + '&workspaceId=' + encodeURIComponent(workspaceId)
  if (provider === 'slack') {
    return {
      connect: '/api/v1/surfaces/slack/connect?purpose=sync&' + back,
      connectAccount: '/api/v1/surfaces/slack/connect?purpose=sync_member&' + back,
      appPackage: null,
    }
  }
  return {
    connect: '/api/v1/sync/teams/connect?' + back,
    connectAccount: '/api/v1/sync/teams/account/connect?' + back,
    appPackage: '/api/v1/sync/teams/app-package?workspaceId=' + encodeURIComponent(workspaceId),
  }
}

/** Percent of the history window imported so far, measured back from when the link was created. */
export function historyProgress(link: Pick<SyncLinkRow, 'createdAt' | 'historyTargetAt' | 'historyOldestAt'>): number {
  if (link.historyTargetAt === undefined || link.historyOldestAt === undefined) return 0
  const span = link.createdAt - link.historyTargetAt
  if (span <= 0) return 100
  return Math.round(Math.min(1, Math.max(0, (link.createdAt - link.historyOldestAt) / span)) * 100)
}

/** Plain-language status line under a link's state. */
export function linkStatusDetail(provider: SyncProvider, link: SyncLinkRow, now: number): string | null {
  const name = SYNC_PROVIDERS[provider].name
  if (link.status === 'history') return historyProgress(link) + '% of the last 180 days · new messages already sync'
  if (link.status === 'catching_up') {
    const minutes = link.catchUpUntil ? Math.ceil((link.catchUpUntil - now) / 60_000) : 0
    return 'The ' + name + ' rate limit was reached. ' + (minutes > 0 ? 'Resumes automatically in ' + minutes + ' min.' : 'Resumes automatically.')
  }
  if (link.status !== 'paused') return null
  if (link.pauseReason === 'disconnected' || link.pauseReason === 'token_revoked') return 'Reconnect ' + name + ' to resume.'
  if (link.pauseReason === 'not_in_channel' || link.pauseReason === 'app_removed') return 'Add Overlay to this channel in ' + name + ' to resume.'
  if (link.pauseReason === 'channel_archived') return 'The channel was archived in ' + name + '.'
  if (link.pauseReason?.includes(' ')) return link.pauseReason
  return 'Sync stopped. Unlink and link the channel again to restart it.'
}

/** The one-line health note under the channel table. */
export function healthNote(provider: SyncProvider, links: SyncLinkRow[]): { tone: 'ok' | 'busy' | 'warning'; text: string } | null {
  if (links.length === 0) return null
  const name = SYNC_PROVIDERS[provider].name
  const paused = links.filter(link => link.status === 'paused').length
  if (paused > 0) return { tone: 'warning', text: paused === 1 ? '1 channel is paused. Its fix is shown next to it.' : paused + ' channels are paused. Each fix is shown next to it.' }
  if (links.some(link => link.status === 'catching_up')) return { tone: 'busy', text: 'The ' + name + ' rate limit was reached. Sync catches up on its own.' }
  const importing = links.filter(link => link.status === 'history').length
  if (importing > 0) return { tone: 'busy', text: 'Importing history for ' + importing + (importing === 1 ? ' channel' : ' channels') + '. New messages already sync.' }
  return { tone: 'ok', text: links.length === 1 ? 'The linked channel is live.' : 'All ' + links.length + ' linked channels are live.' }
}

const CONNECT_ERRORS: Record<string, string> = {
  expired_state: 'That connection expired. Start it again.',
  denied: 'The connection was cancelled.',
  missing_code: 'No authorization code came back. Try again.',
  account_mismatch: 'Finish connecting with the account that started it.',
  connect_failed: 'Could not start the connection. Try again.',
  exchange_failed: 'The connection was rejected. Try again.',
  forbidden: 'Only workspace owners and admins can connect the workspace.',
  slack_not_configured: 'Slack is not configured on this deployment.',
  teams_not_configured: 'Microsoft Teams sync isn’t available yet.',
  team_already_connected: 'That workspace is already connected to another Overlay workspace.',
  org_connected_elsewhere: 'That organization is already connected to another Overlay workspace.',
  not_connected: 'An owner or admin needs to connect the workspace first.',
  sync_not_connected: 'An owner or admin needs to connect the workspace first.',
  teams_not_connected: 'An owner or admin needs to connect Microsoft Teams first.',
  already_connected: 'This workspace is already connected to a different organization.',
  consent_missing: 'Microsoft did not confirm admin consent for that organization. Try again as its admin.',
  team_mismatch: 'Sign in to the Slack workspace this Overlay workspace syncs with.',
  wrong_organization: 'Sign in with an account from the connected Microsoft organization.',
  account_in_use: 'That Slack account is already connected by another member.',
  account_claimed: 'That Microsoft account is already connected by another member.',
}

/** Query parameters the connect callbacks add when they return to settings. */
export const OAUTH_RETURN_PARAMS = ['syncConnected', 'syncAccountConnected', 'surfaceError', 'syncError'] as const

/** The toast to show after returning from an OAuth connect, read from the parameters in OAUTH_RETURN_PARAMS. */
export function oauthReturnNotice(params: URLSearchParams): { kind: 'success' | 'error'; text: string; provider: SyncProvider | null } | null {
  const account = params.get('syncAccountConnected')
  const connected = account ?? params.get('syncConnected')
  if (connected) {
    const provider: SyncProvider = connected.startsWith('teams') ? 'teams' : 'slack'
    const name = SYNC_PROVIDERS[provider].name
    const member = account !== null || /(member|account)$/.test(connected)
    return { kind: 'success', provider, text: member ? 'Your ' + name + ' account is connected.' : name + ' connected.' }
  }
  const reason = params.get('surfaceError') ?? params.get('syncError')
  if (!reason) return null
  return { kind: 'error', provider: null, text: CONNECT_ERRORS[reason] ?? 'The connection failed. Try again.' }
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })

export function connectedDetail(connection: NonNullable<SyncProviderStatus['connection']>): string {
  if (connection.status === 'paused') return 'Paused. New messages wait until it resumes.'
  return 'Connected ' + DATE_FORMAT.format(connection.connectedAt) + (connection.connectedByName ? ' by ' + connection.connectedByName : '')
}
