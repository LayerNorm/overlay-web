/**
 * Accounts an agent runs on: the person's own Claude or OpenAI credentials,
 * delivered to an Overlay Cloud machine for one run at a time. Nothing here is
 * secret; values live in the credential vault.
 */

export const AGENT_PROVIDER_IDS = ['claude-code', 'codex', 'opencode', 'hermes', 'cursor'] as const
export type AgentProviderId = (typeof AGENT_PROVIDER_IDS)[number]

export const AGENT_PROVIDER_AUTH_METHODS = ['subscription', 'api_key'] as const
export type AgentProviderAuthMethod = (typeof AGENT_PROVIDER_AUTH_METHODS)[number]

export type AgentProviderAccountStatus = 'active' | 'needs_reauth'

export type AgentProviderDefinition = {
  id: AgentProviderId
  label: string
  /** Not yet proven with real accounts: offered as bring-your-own-key and labelled as such. */
  experimental?: boolean
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
  // Experimental agents: their own CLIs are on the machine, each brings its own key (an environment variable).
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    experimental: true,
    methods: ['api_key'],
    env: { api_key: 'OPENROUTER_API_KEY' },
    help: { subscription: null, api_key: 'An OpenRouter API key, which gives OpenCode access to most models. Usage is billed to your OpenRouter account.' },
  },
  hermes: {
    id: 'hermes',
    label: 'Hermes',
    experimental: true,
    methods: ['api_key'],
    env: { api_key: 'OPENROUTER_API_KEY' },
    help: { subscription: null, api_key: 'An OpenRouter API key. Usage is billed to your OpenRouter account.' },
  },
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    experimental: true,
    methods: ['api_key'],
    env: { api_key: 'CURSOR_API_KEY' },
    help: { subscription: null, api_key: 'A Cursor API key from your Cursor account settings. Usage is billed to your Cursor plan.' },
  },
}

export const MAX_AGENT_PROVIDER_SECRET_LENGTH = 4_096
export const MAX_AGENT_PROVIDER_LABEL_LENGTH = 80

export function isAgentProviderId(value: unknown): value is AgentProviderId {
  return typeof value === 'string' && (AGENT_PROVIDER_IDS as readonly string[]).includes(value)
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
  const name = AGENT_PROVIDERS[provider].env[method]
  if (!name) return null
  return { [name]: secret, ...EXPERIMENTAL_AGENT_DEFAULT_ENV[provider] }
}

/**
 * Experimental agents run on OpenRouter, so they get a cheap default model instead of whatever the tool would pick.
 * The agent's own config (imported or edited on the machine) can still override it.
 */
const CHEAP_OPENROUTER_MODEL = 'deepseek/deepseek-v4-flash'
const EXPERIMENTAL_AGENT_DEFAULT_ENV: Partial<Record<AgentProviderId, Record<string, string>>> = {
  opencode: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: `openrouter/${CHEAP_OPENROUTER_MODEL}` }) },
  hermes: { HERMES_INFERENCE_PROVIDER: 'openrouter', LLM_MODEL: CHEAP_OPENROUTER_MODEL },
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
  opencode: 'OpenCode could not sign in. Reconnect your OpenRouter key in Settings → Agent accounts.',
  hermes: 'Hermes could not sign in. Reconnect your OpenRouter key in Settings → Agent accounts.',
  cursor: 'Cursor could not sign in. Reconnect your Cursor key in Settings → Agent accounts.',
}

/** Failure code a host reports when the agent rejected its credentials. */
export const AGENT_AUTH_FAILURE_CODE = 'auth_required'
