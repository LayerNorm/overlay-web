/**
 * Provider identifiers include historical account records. Only supported
 * providers may be configured or receive credentials for a run.
 */

export const AGENT_PROVIDER_IDS = ['claude-code', 'codex', 'opencode', 'hermes', 'cursor'] as const
export type AgentProviderId = (typeof AGENT_PROVIDER_IDS)[number]

export const SUPPORTED_AGENT_PROVIDER_IDS = ['claude-code', 'codex'] as const
export type SupportedAgentProviderId = (typeof SUPPORTED_AGENT_PROVIDER_IDS)[number]
export const SELECTABLE_AGENT_PROVIDER_IDS = SUPPORTED_AGENT_PROVIDER_IDS

export const AGENT_PROVIDER_AUTH_METHODS = ['subscription', 'api_key'] as const
export type AgentProviderAuthMethod = (typeof AGENT_PROVIDER_AUTH_METHODS)[number]

export type AgentProviderAccountStatus = 'active' | 'needs_reauth'

export type AgentProviderDefinition = {
  id: AgentProviderId
  label: string
  /** Methods offered. Codex subscriptions are signed in with ChatGPT and kept alive by a credential broker. */
  methods: readonly AgentProviderAuthMethod[]
  /** Environment variable the agent process reads, per method. */
  env: Partial<Record<AgentProviderAuthMethod, string>>
  /** What to tell a person who needs to produce the credential. */
  help: Record<AgentProviderAuthMethod, string | null>
}

export const AGENT_PROVIDERS: Record<AgentProviderId, AgentProviderDefinition> = {
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code',
    methods: ['subscription', 'api_key'],
    env: { subscription: 'CLAUDE_CODE_OAUTH_TOKEN', api_key: 'ANTHROPIC_API_KEY' },
    help: {
      subscription: 'Run "claude setup-token" on your own computer and paste the token it prints. Overlay never reads your existing Claude login.',
      api_key: 'An Anthropic API key. Usage is billed to your Anthropic account.',
    },
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    methods: ['subscription', 'api_key'],
    // A subscription is not an environment variable: Codex reads an auth.json that Overlay writes for each run.
    env: { api_key: 'OPENAI_API_KEY' },
    help: {
      subscription: 'Sign in with your ChatGPT account. Overlay keeps the sign-in refreshed and gives each run only a short-lived token.',
      api_key: 'An OpenAI API key. Usage is billed to your OpenAI account.',
    },
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    methods: [],
    env: {},
    help: { subscription: null, api_key: null },
  },
  hermes: {
    id: 'hermes',
    label: 'Hermes',
    methods: [],
    env: {},
    help: { subscription: null, api_key: null },
  },
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    methods: [],
    env: {},
    help: { subscription: null, api_key: null },
  },
}

export const MAX_AGENT_PROVIDER_SECRET_LENGTH = 4_096
export const MAX_AGENT_PROVIDER_LABEL_LENGTH = 80

export function isAgentProviderId(value: unknown): value is AgentProviderId {
  return typeof value === 'string' && (AGENT_PROVIDER_IDS as readonly string[]).includes(value)
}

export function isSupportedAgentProviderId(value: unknown): value is SupportedAgentProviderId {
  return typeof value === 'string' && (SUPPORTED_AGENT_PROVIDER_IDS as readonly string[]).includes(value)
}

export function isAgentProviderAuthMethod(value: unknown): value is AgentProviderAuthMethod {
  return typeof value === 'string' && (AGENT_PROVIDER_AUTH_METHODS as readonly string[]).includes(value)
}

/** The environment variables a run needs for this account, or null when the method is unsupported. */
export function agentProviderEnv(
  provider: AgentProviderId,
  method: AgentProviderAuthMethod,
  secret: string,
): Record<string, string> | null {
  if (!isSupportedAgentProviderId(provider)) return null
  const name = AGENT_PROVIDERS[provider].env[method]
  if (!name) return null
  return { [name]: secret }
}

export type AgentProviderSecretCheck = { ok: true; secret: string } | { ok: false; reason: string }

/**
 * Cheap, local checks on a pasted credential. They catch the common mistakes
 * (an API key pasted as a subscription token, whitespace, a truncated paste)
 * without claiming to know every vendor token format.
 */
export function checkAgentProviderSecret(
  provider: AgentProviderId,
  method: AgentProviderAuthMethod,
  raw: unknown,
): AgentProviderSecretCheck {
  if (!isSupportedAgentProviderId(provider)) {
    return { ok: false, reason: 'This agent is no longer supported. Remove its account in Settings → Agent accounts.' }
  }
  if (typeof raw !== 'string') return { ok: false, reason: 'Enter the credential.' }
  const secret = raw.trim()
  if (!secret) return { ok: false, reason: 'Enter the credential.' }
  if (secret.length > MAX_AGENT_PROVIDER_SECRET_LENGTH) return { ok: false, reason: 'That credential is too long.' }
  if (/\s/.test(secret)) return { ok: false, reason: 'The credential must be a single line with no spaces.' }
  if (!AGENT_PROVIDERS[provider].methods.includes(method)) {
    return { ok: false, reason: `${AGENT_PROVIDERS[provider].label} does not support that sign-in method yet.` }
  }
  if (provider === 'claude-code') {
    if (method === 'subscription' && secret.startsWith('sk-ant-api')) {
      return { ok: false, reason: 'That looks like an API key. Choose "API key", or run "claude setup-token" for a subscription token.' }
    }
    if (method === 'api_key' && secret.startsWith('sk-ant-oat')) {
      return { ok: false, reason: 'That looks like a subscription token. Choose "Subscription".' }
    }
  }
  if (provider === 'codex' && secret.startsWith('sk-ant-')) {
    return { ok: false, reason: 'That looks like an Anthropic key. Codex needs an OpenAI API key.' }
  }
  if (secret.length < 20) return { ok: false, reason: 'That credential looks too short. Paste the whole value.' }
  return { ok: true, secret }
}

/** Public shape of an account: never includes the credential or its vault reference. */
export type AgentProviderAccount = {
  id: string
  provider: AgentProviderId
  method: AgentProviderAuthMethod
  label: string
  status: AgentProviderAccountStatus
  lastError?: string
  lastUsedAt?: number
  createdAt: number
  updatedAt: number
}

export const AGENT_PROVIDER_REAUTH_MESSAGE: Record<AgentProviderId, string> = {
  'claude-code': 'Claude Code could not sign in. Reconnect your Claude account in Settings → Agent accounts.',
  codex: 'Codex could not sign in. Reconnect your OpenAI account in Settings → Agent accounts.',
  opencode: 'OpenCode is no longer supported. Remove its account in Settings → Agent accounts.',
  hermes: 'Hermes is no longer supported. Remove its account in Settings → Agent accounts.',
  cursor: 'Cursor is no longer supported. Remove its account in Settings → Agent accounts.',
}

/** Failure code a host reports when the agent rejected its credentials. */
export const AGENT_AUTH_FAILURE_CODE = 'auth_required'
