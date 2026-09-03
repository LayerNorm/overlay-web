import 'server-only'

import type { WorkspacePlatformInstallationRecord } from '@/server/workspaces/WorkspaceRepository'
import type { WorkspaceGovernanceService } from '@/server/governance/WorkspaceGovernanceService'
import { decryptPlatformToken, encryptPlatformToken } from './slack-token-crypto'
import { signInstallState } from './slack-oauth-state'
import { loadSlackApi, type CallSlackApi } from './slack-adapter-modules'

export type SlackOAuthDeps = {
  governance: Pick<WorkspaceGovernanceService, 'linkPlatformInstallation'>
  exchangeCode: (args: { code: string; redirectUri: string }) => Promise<SlackOAuthTokens>
  encryptToken: (plaintext: string) => string
}

export type SlackOAuthTokens = {
  botToken: string
  teamId: string
  teamName?: string
  enterpriseId?: string
  isEnterpriseInstall: boolean
  botUserId?: string
  appId?: string
}

/**
 * Multi-workspace Slack installs (Phase B1). A workspace manager mints a
 * short-lived signed state through the authenticated install route; Slack
 * calls back here without a session, the state signature authorizes the
 * link, the code is exchanged, and the token is stored encrypted in our own
 * installation table — never in SDK state.
 */
export class SlackInstallService {
  constructor(private readonly deps: SlackOAuthDeps) {}

  authorizeUrl(args: {
    clientId: string
    redirectUri: string
    scopes: string
    state: string
  }): string {
    const params = new URLSearchParams({
      client_id: args.clientId,
      scope: args.scopes,
      redirect_uri: args.redirectUri,
      state: args.state,
    })
    return `https://slack.com/oauth/v2/authorize?${params.toString()}`
  }

  async completeInstall(args: {
    code: string
    claim: { workspaceId: string; principalId: string; directory: string }
    redirectUri: string
    actorUserId: string
  }): Promise<{ workspaceId: string; teamId: string }> {
    if (args.claim.directory !== 'slack') throw new Error('PLATFORM_INSTALL_STATE_INVALID')
    const tokens = await this.deps.exchangeCode({ code: args.code, redirectUri: args.redirectUri })
    await this.deps.governance.linkPlatformInstallation({
      actorUserId: args.actorUserId,
      workspaceId: args.claim.workspaceId,
      directory: 'slack',
      externalTeamId: tokens.teamId,
      enterpriseId: tokens.enterpriseId,
      isEnterpriseInstall: tokens.isEnterpriseInstall,
      teamName: tokens.teamName,
      botUserId: tokens.botUserId,
      botTokenCipher: this.deps.encryptToken(tokens.botToken),
    })
    return { workspaceId: args.claim.workspaceId, teamId: tokens.teamId }
  }
}

export function mintInstallState(args: {
  workspaceId: string
  principalId: string
  secret: string
  now?: number
}): string {
  return signInstallState({ ...args, directory: 'slack' })
}

/** Default code exchange against Slack's OAuth endpoint (injectable for tests). */
export async function exchangeSlackCode(args: {
  code: string
  redirectUri: string
  clientId: string
  clientSecret: string
}): Promise<SlackOAuthTokens> {
  const { callSlackApi } = await loadSlackApi()
  const response = await (callSlackApi as CallSlackApi)<{
    ok: boolean
    access_token?: string
    team?: { id?: string; name?: string }
    enterprise?: { id?: string }
    is_enterprise_install?: boolean
    bot_user_id?: string
    app_id?: string
    error?: string
  }>('oauth.v2.access', {
    code: args.code,
    client_id: args.clientId,
    client_secret: args.clientSecret,
    redirect_uri: args.redirectUri,
  }, { contentType: 'form', token: '' })
  if (!response.ok || !response.access_token || !response.team?.id) {
    throw new Error(`SLACK_OAUTH_EXCHANGE_FAILED:${response.error ?? 'unknown'}`)
  }
  return {
    botToken: response.access_token,
    teamId: response.team.id,
    teamName: response.team.name,
    enterpriseId: response.enterprise?.id,
    isEnterpriseInstall: response.is_enterprise_install ?? false,
    botUserId: response.bot_user_id,
    appId: response.app_id,
  }
}

export function installationProvider(deps: {
  getRecord: (installationId: string) => Promise<WorkspacePlatformInstallationRecord | null>
  decryptToken: (cipher: string) => string
}) {
  return {
    async getInstallation(installationId: string, _isEnterpriseInstall: boolean) {
      const record = await deps.getRecord(installationId)
      if (!record) return null
      return {
        botToken: deps.decryptToken(record.botTokenCipher),
        botUserId: record.botUserId,
        enterpriseId: record.enterpriseId,
        isEnterpriseInstall: record.isEnterpriseInstall,
        teamName: record.teamName,
      }
    },
  }
}

export { decryptPlatformToken, encryptPlatformToken }
