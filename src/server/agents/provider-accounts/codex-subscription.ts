import 'server-only'

/**
 * Signing in to Codex with a ChatGPT subscription, and keeping that sign-in alive for Overlay Cloud machines.
 *
 * Codex signs in with OAuth. Its access token is short-lived and its refresh token **rotates on every use**, so two
 * machines holding the same sign-in would invalidate each other. Overlay keeps the only refresh token, in the
 * credential vault, refreshes it one at a time, and hands a machine only the short-lived tokens for the run (with the
 * refresh token left out), written as the `auth.json` Codex reads.
 *
 * The endpoints and client id are the ones Codex itself uses (openai/codex, `codex-rs/login`): device-code sign-in at
 * `{issuer}/api/accounts/deviceauth/*`, token exchange and refresh at `{issuer}/oauth/token`.
 */

export const CODEX_ISSUER = 'https://auth.openai.com'
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const CODEX_DEVICE_VERIFICATION_URL = `${CODEX_ISSUER}/codex/device`
/** Refresh when the access token has less than this left, so a run never starts on a token about to expire. */
export const CODEX_REFRESH_MARGIN_MS = 25 * 60_000
/** A placeholder Codex cannot use to refresh: the machine must never hold the real refresh token. */
const MACHINE_REFRESH_PLACEHOLDER = 'overlay-managed-refresh-token-not-valid'

export type CodexFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ status: number; text(): Promise<string> }>

export class CodexSignInError extends Error {
  constructor(message: string, readonly code: 'pending' | 'denied' | 'expired' | 'rejected' | 'transient' | 'unsupported') {
    super(message)
    this.name = 'CodexSignInError'
  }
}

/** What is stored (as one vault secret) for a Codex subscription account. */
export type CodexTokenSet = {
  v: 1
  idToken: string
  accessToken: string
  refreshToken: string
  accountId?: string
  /** When these tokens were last issued. */
  lastRefresh: number
  /** For the account's label and for display only. */
  plan?: string
}

export type CodexDeviceCode = {
  deviceAuthId: string
  userCode: string
  verificationUrl: string
  /** Seconds between polls. */
  interval: number
  expiresAt: number
}

const defaultFetch: CodexFetch = (url, init) => fetch(url, init)

function json(response: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(response)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch (_error) {
    return {}
  }
}

/** Step one: ask for a one-time code the person enters at the verification URL. */
export async function requestCodexDeviceCode(options: { fetch?: CodexFetch; now?: () => number } = {}): Promise<CodexDeviceCode> {
  const fetcher = options.fetch ?? defaultFetch
  const now = (options.now ?? Date.now)()
  let response: Awaited<ReturnType<CodexFetch>>
  try {
    response = await fetcher(`${CODEX_ISSUER}/api/accounts/deviceauth/usercode`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (_error) {
    throw new CodexSignInError('Could not reach OpenAI. Try again.', 'transient')
  }
  if (response.status === 404) throw new CodexSignInError('ChatGPT sign-in for Codex is not available right now.', 'unsupported')
  if (response.status < 200 || response.status >= 300) throw new CodexSignInError('OpenAI did not start the sign-in. Try again.', 'transient')
  const body = json(await response.text())
  const deviceAuthId = typeof body.device_auth_id === 'string' ? body.device_auth_id : ''
  const userCode = typeof body.user_code === 'string' ? body.user_code : typeof body.usercode === 'string' ? body.usercode : ''
  const interval = Math.max(2, Math.min(30, Number(body.interval) || 5))
  if (!deviceAuthId || !userCode) throw new CodexSignInError('OpenAI sent an unexpected sign-in response.', 'transient')
  return { deviceAuthId, userCode, verificationUrl: CODEX_DEVICE_VERIFICATION_URL, interval, expiresAt: now + 15 * 60_000 }
}

/**
 * Step two, polled until the person has approved: returns the tokens once they have, throws `pending` until then.
 * OpenAI answers 403 or 404 while the code has not been approved yet.
 */
export async function pollCodexDeviceCode(
  args: { deviceAuthId: string; userCode: string },
  options: { fetch?: CodexFetch; now?: () => number } = {},
): Promise<CodexTokenSet> {
  const fetcher = options.fetch ?? defaultFetch
  let response: Awaited<ReturnType<CodexFetch>>
  try {
    response = await fetcher(`${CODEX_ISSUER}/api/accounts/deviceauth/token`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_auth_id: args.deviceAuthId, user_code: args.userCode }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (_error) {
    throw new CodexSignInError('Could not reach OpenAI. Try again.', 'transient')
  }
  if (response.status === 403 || response.status === 404) throw new CodexSignInError('Waiting for you to approve the sign-in.', 'pending')
  if (response.status < 200 || response.status >= 300) throw new CodexSignInError('OpenAI refused the sign-in. Start again.', 'denied')
  const body = json(await response.text())
  const code = typeof body.authorization_code === 'string' ? body.authorization_code : ''
  const verifier = typeof body.code_verifier === 'string' ? body.code_verifier : ''
  if (!code || !verifier) throw new CodexSignInError('OpenAI sent an unexpected sign-in response.', 'transient')
  return await tokensFrom(await postToken(fetcher, 'form', {
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${CODEX_ISSUER}/deviceauth/callback`,
    client_id: CODEX_CLIENT_ID,
    code_verifier: verifier,
  }), options.now)
}

/**
 * Exchanges the refresh token for new tokens. The old refresh token stops working, so the caller must store the result
 * before anything else can refresh. A rejected refresh token (revoked, already used) is permanent: `rejected`.
 */
export async function refreshCodexTokens(
  current: CodexTokenSet,
  options: { fetch?: CodexFetch; now?: () => number } = {},
): Promise<CodexTokenSet> {
  const body = await postToken(options.fetch ?? defaultFetch, 'json', {
    client_id: CODEX_CLIENT_ID, grant_type: 'refresh_token', refresh_token: current.refreshToken,
  })
  // A refresh may omit tokens it did not rotate; keep what we have.
  return await tokensFrom({
    ...body,
    ...(typeof body.refresh_token === 'string' ? {} : { refresh_token: current.refreshToken }),
    ...(typeof body.id_token === 'string' ? {} : { id_token: current.idToken }),
  }, options.now, current)
}

async function postToken(fetcher: CodexFetch, encoding: 'form' | 'json', fields: Record<string, string>): Promise<Record<string, unknown>> {
  let response: Awaited<ReturnType<CodexFetch>>
  try {
    response = await fetcher(`${CODEX_ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': encoding === 'json' ? 'application/json' : 'application/x-www-form-urlencoded' },
      body: encoding === 'json' ? JSON.stringify(fields) : new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (_error) {
    throw new CodexSignInError('Could not reach OpenAI. Try again.', 'transient')
  }
  const text = await response.text()
  if (response.status >= 200 && response.status < 300) return json(text)
  const detail = json(text)
  const error = typeof detail.error === 'string' ? detail.error : typeof (detail.error as { code?: string } | undefined)?.code === 'string' ? (detail.error as { code: string }).code : ''
  if (response.status === 400 || response.status === 401 || /invalid_grant|refresh_token_(expired|reused|invalidated)/i.test(error)) {
    throw new CodexSignInError('OpenAI no longer accepts this ChatGPT sign-in. Sign in again.', 'rejected')
  }
  throw new CodexSignInError('OpenAI could not refresh the sign-in right now.', 'transient')
}

async function tokensFrom(body: Record<string, unknown>, nowFn?: () => number, previous?: CodexTokenSet): Promise<CodexTokenSet> {
  const idToken = typeof body.id_token === 'string' ? body.id_token : ''
  const accessToken = typeof body.access_token === 'string' ? body.access_token : ''
  const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : ''
  if (!idToken || !accessToken || !refreshToken) throw new CodexSignInError('OpenAI sent an incomplete sign-in.', 'transient')
  const claims = jwtClaims(idToken)
  const auth = (claims['https://api.openai.com/auth'] ?? {}) as Record<string, unknown>
  const accountId = typeof auth.chatgpt_account_id === 'string' ? auth.chatgpt_account_id : previous?.accountId
  const plan = typeof auth.chatgpt_plan_type === 'string' ? auth.chatgpt_plan_type : previous?.plan
  return { v: 1, idToken, accessToken, refreshToken, ...(accountId ? { accountId } : {}), lastRefresh: (nowFn ?? Date.now)(), ...(plan ? { plan } : {}) }
}

/** Claims of a JWT, unverified: used only to read an expiry and an account id from tokens OpenAI just issued. */
export function jwtClaims(token: string): Record<string, unknown> {
  const part = token.split('.')[1]
  if (!part) return {}
  try {
    return json(Buffer.from(part, 'base64url').toString('utf8'))
  } catch (_error) {
    return {}
  }
}

/** When the access token stops working (ms), or 0 when it cannot be read, which reads as "refresh now". */
export function codexAccessTokenExpiry(tokens: CodexTokenSet): number {
  const exp = jwtClaims(tokens.accessToken).exp
  return typeof exp === 'number' ? exp * 1000 : 0
}

export function codexTokensNeedRefresh(tokens: CodexTokenSet, now: number): boolean {
  return codexAccessTokenExpiry(tokens) - now < CODEX_REFRESH_MARGIN_MS
}

export function serializeCodexTokens(tokens: CodexTokenSet): string {
  return JSON.stringify(tokens)
}

export function parseCodexTokens(secret: string): CodexTokenSet | null {
  const parsed = json(secret)
  if (parsed.v !== 1 || typeof parsed.idToken !== 'string' || typeof parsed.accessToken !== 'string'
    || typeof parsed.refreshToken !== 'string' || typeof parsed.lastRefresh !== 'number') return null
  return parsed as unknown as CodexTokenSet
}

/**
 * The `auth.json` a machine gets for one run: the short-lived tokens only. The refresh token is a placeholder, so a
 * machine that is compromised, or an agent that reads the file, cannot refresh (and so cannot invalidate Overlay's
 * copy, or keep the sign-in alive past the run's token).
 */
export function codexAuthJsonForMachine(tokens: CodexTokenSet): string {
  return `${JSON.stringify({
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: tokens.idToken,
      access_token: tokens.accessToken,
      refresh_token: MACHINE_REFRESH_PLACEHOLDER,
      ...(tokens.accountId ? { account_id: tokens.accountId } : {}),
    },
    last_refresh: new Date(tokens.lastRefresh).toISOString(),
  }, null, 2)}\n`
}

export const CODEX_MACHINE_AUTH_PATH = '/home/user/.codex/auth.json'
