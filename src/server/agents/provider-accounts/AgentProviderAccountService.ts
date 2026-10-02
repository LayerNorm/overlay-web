import 'server-only'

import type { ByokCredentialStore } from '@/server/ai/gateway/byok-credential-store'
import type { AuditService } from '@/server/admin'
import {
  AGENT_PROVIDERS,
  agentProviderEnv,
  checkAgentProviderSecret,
  MAX_AGENT_PROVIDER_LABEL_LENGTH,
  type AgentProviderAccount,
  type AgentProviderAuthMethod,
  type AgentProviderId,
} from '@/shared/agents/provider-accounts'
import type { AgentProviderAccountRepository } from './AgentProviderAccountRepository'

export const MAX_AGENT_PROVIDER_ACCOUNTS_PER_USER = 20
const VERIFY_TIMEOUT_MS = 8_000

export class AgentProviderAccountError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) {
    super(message)
    this.name = 'AgentProviderAccountError'
  }
}

type Fetch = (input: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number }>

/**
 * The credentials an agent runs on. The secret goes to the credential vault;
 * Convex keeps metadata and the vault reference. A credential leaves the vault
 * only in `resolveRunEnvironment`, for one run, and is never logged or stored
 * on a machine.
 */
export class AgentProviderAccountService {
  constructor(private readonly dependencies: {
    repository: AgentProviderAccountRepository
    store: ByokCredentialStore
    audit: Pick<AuditService, 'record'>
    fetch?: Fetch
    now?: () => number
  }) {}

  async list(userId: string): Promise<AgentProviderAccount[]> {
    return await this.dependencies.repository.listPublic({ userId })
  }

  async connect(args: {
    userId: string
    provider: AgentProviderId
    method: AgentProviderAuthMethod
    label?: string
    secret: unknown
  }): Promise<AgentProviderAccount> {
    const checked = checkAgentProviderSecret(args.provider, args.method, args.secret)
    if (!checked.ok) throw new AgentProviderAccountError(checked.reason, 400, 'credential_invalid')
    if (await this.verify(args.provider, args.method, checked.secret) === 'invalid') {
      throw new AgentProviderAccountError(`${AGENT_PROVIDERS[args.provider].label} rejected that credential.`, 400, 'credential_rejected')
    }
    const label = normalizeLabel(args.label) ?? defaultLabel(args.provider, args.method)
    const credentialRef = await this.dependencies.store.write({
      apiKey: checked.secret,
      context: { purpose: 'agent-provider-account', userId: args.userId, providerId: args.provider },
    })
    try {
      const id = await this.dependencies.repository.create({
        userId: args.userId, provider: args.provider, method: args.method, label, credentialRef,
        maxAccounts: MAX_AGENT_PROVIDER_ACCOUNTS_PER_USER,
      })
      await this.audit('agent_provider_account.connected', args.userId, id, { provider: args.provider, method: args.method })
      const created = (await this.list(args.userId)).find((account) => account.id === id)
      if (!created) throw new AgentProviderAccountError('The account could not be read back', 500, 'account_missing')
      return created
    } catch (error) {
      await this.dependencies.store.delete(credentialRef).catch((_error) => undefined)
      if (error instanceof Error && error.message.includes('AGENT_PROVIDER_ACCOUNT_LIMIT')) {
        throw new AgentProviderAccountError('You have reached the limit of connected accounts. Remove one first.', 429, 'account_limit_reached')
      }
      throw error
    }
  }

  /** Replaces the credential on an existing account (for example after it expired) and clears its error. */
  async reconnect(args: { userId: string; accountId: string; secret: unknown }): Promise<AgentProviderAccount> {
    const account = await this.requireOwned(args.userId, args.accountId)
    const checked = checkAgentProviderSecret(account.provider, account.method, args.secret)
    if (!checked.ok) throw new AgentProviderAccountError(checked.reason, 400, 'credential_invalid')
    if (await this.verify(account.provider, account.method, checked.secret) === 'invalid') {
      throw new AgentProviderAccountError(`${AGENT_PROVIDERS[account.provider].label} rejected that credential.`, 400, 'credential_rejected')
    }
    await this.dependencies.store.update({ credentialRef: account.credentialRef, apiKey: checked.secret })
    await this.dependencies.repository.update({ accountId: account.id, status: 'active', lastError: null })
    await this.audit('agent_provider_account.reconnected', args.userId, account.id, { provider: account.provider })
    const updated = (await this.list(args.userId)).find((candidate) => candidate.id === account.id)
    if (!updated) throw new AgentProviderAccountError('Account not found', 404, 'account_not_found')
    return updated
  }

  async rename(args: { userId: string; accountId: string; label: string }): Promise<void> {
    await this.requireOwned(args.userId, args.accountId)
    const label = normalizeLabel(args.label)
    if (!label) throw new AgentProviderAccountError('Enter a name.', 400, 'label_invalid')
    await this.dependencies.repository.update({ accountId: args.accountId, label })
  }

  async remove(args: { userId: string; accountId: string }): Promise<void> {
    const account = await this.requireOwned(args.userId, args.accountId)
    // The vault goes first: a credential must be unrecoverable as soon as the person disconnects.
    await this.dependencies.store.delete(account.credentialRef)
    await this.dependencies.repository.remove({ accountId: account.id })
    await this.audit('agent_provider_account.removed', args.userId, account.id, { provider: account.provider })
  }

  /** The agent rejected this account's credentials. Shown as "Reconnect" in Settings. */
  async markNeedsReauth(accountId: string, reason?: string): Promise<void> {
    await this.dependencies.repository.update({
      accountId,
      status: 'needs_reauth',
      lastError: (reason ?? 'The provider rejected the credential.').slice(0, 300),
    }).catch((_error) => undefined)
  }

  /**
   * The environment variables for one run. `ownerUserId` is the user the
   * binding recorded when it chose this account; a mismatch means the binding
   * was tampered with, so nothing is released.
   */
  async resolveRunEnvironment(args: {
    accountId: string
    ownerUserId: string
    expectedProvider: AgentProviderId
  }): Promise<{ env: Record<string, string>; provider: AgentProviderId; method: AgentProviderAuthMethod }> {
    const account = await this.dependencies.repository.get({ accountId: args.accountId })
    if (!account || account.userId !== args.ownerUserId || account.provider !== args.expectedProvider) {
      throw new AgentProviderAccountError('This agent has no usable account', 409, 'account_unavailable')
    }
    if (account.status === 'needs_reauth') {
      throw new AgentProviderAccountError('Reconnect this account in Settings → Agent accounts', 409, 'account_needs_reauth')
    }
    const secret = await this.dependencies.store.read(account.credentialRef)
    if (!secret) {
      await this.markNeedsReauth(account.id, 'The stored credential is missing.')
      throw new AgentProviderAccountError('Reconnect this account in Settings → Agent accounts', 409, 'account_needs_reauth')
    }
    const env = agentProviderEnv(account.provider, account.method, secret)
    if (!env) throw new AgentProviderAccountError('This account type is not supported', 409, 'account_unavailable')
    await this.dependencies.repository.update({ accountId: account.id, lastUsedAt: this.now() }).catch((_error) => undefined)
    return { env, provider: account.provider, method: account.method }
  }

  /** The account when it exists, belongs to `userId`, and fits `provider`. Throws otherwise. */
  async requireUsable(args: { userId: string; accountId: string; provider: AgentProviderId }) {
    const account = await this.requireOwned(args.userId, args.accountId)
    if (account.provider !== args.provider) {
      throw new AgentProviderAccountError('That account is for a different agent', 400, 'account_provider_mismatch')
    }
    return account
  }

  /**
   * API keys are checked against the vendor's model list (a read-only call). A
   * subscription token has no equivalent public check, so it is accepted and
   * a bad one surfaces on first use as "needs sign-in".
   */
  private async verify(provider: AgentProviderId, method: AgentProviderAuthMethod, secret: string): Promise<'valid' | 'invalid' | 'unknown'> {
    if (method !== 'api_key') return 'unknown'
    const request: { url: string; headers: Record<string, string> } = provider === 'claude-code'
      ? { url: 'https://api.anthropic.com/v1/models?limit=1', headers: { 'x-api-key': secret, 'anthropic-version': '2023-06-01' } }
      : { url: 'https://api.openai.com/v1/models', headers: { authorization: `Bearer ${secret}` } }
    try {
      const fetcher: Fetch = this.dependencies.fetch ?? ((url, init) => fetch(url, init))
      const response = await fetcher(request.url, {
        method: 'GET', headers: request.headers, signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      })
      if (response.status === 401 || response.status === 403) return 'invalid'
      return response.status >= 200 && response.status < 300 ? 'valid' : 'unknown'
    } catch (_error) {
      return 'unknown'
    }
  }

  private async requireOwned(userId: string, accountId: string) {
    const account = await this.dependencies.repository.get({ accountId })
    // A missing account and someone else's account look the same.
    if (!account || account.userId !== userId) throw new AgentProviderAccountError('Account not found', 404, 'account_not_found')
    return account
  }

  private async audit(action: string, userId: string, accountId: string, metadata: Record<string, unknown>) {
    await this.dependencies.audit.record({
      action, actorType: 'user', actorUserId: userId, outcome: 'success',
      resourceType: 'agent_provider_account', resourceId: accountId, metadata,
    }).catch((_error) => undefined)
  }

  private now() {
    return this.dependencies.now?.() ?? Date.now()
  }
}

function normalizeLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= MAX_AGENT_PROVIDER_LABEL_LENGTH ? trimmed : null
}

function defaultLabel(provider: AgentProviderId, method: AgentProviderAuthMethod): string {
  return `${AGENT_PROVIDERS[provider].label} ${method === 'subscription' ? 'subscription' : 'API key'}`
}
