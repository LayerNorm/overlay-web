import { createServer, type Server } from 'node:http'
import type { LocalPlanProvider } from '@overlay/desktop-bridge'

/**
 * Electron-free parts of the plan proxy (private threads on a person's Claude or ChatGPT plan): CLIProxyAPI's
 * configuration, which credential file belongs to which plan, and the sign-in flow. See plan-proxy-service.ts.
 */

/** How each plan signs in through CLIProxyAPI's management API (v8.1.7). */
export const PLAN_SIGN_IN: Record<LocalPlanProvider, {
  /** Starts the provider's OAuth flow; answers `{ url, state }`. */
  authPath: string
  /** The provider sends the browser back to this port on this computer (fixed by its OAuth client). */
  callbackPort: number
  /** CLIProxyAPI's own route that takes the code and state for the waiting sign-in. */
  forwardPath: string
  /** The `type` CLIProxyAPI writes into this plan's credential file. */
  credentialType: string
}> = {
  claude: { authPath: '/v0/management/anthropic-auth-url', callbackPort: 54545, forwardPath: '/anthropic/callback', credentialType: 'claude' },
  chatgpt: { authPath: '/v0/management/codex-auth-url', callbackPort: 1455, forwardPath: '/codex/callback', credentialType: 'codex' }
}

export const SIGN_IN_TIMEOUT_MS = 5 * 60_000

/**
 * CLIProxyAPI's configuration for one launch: loopback only, one client key for the Agent Host, a management key for
 * this app, no control panel, no LAN discovery, no request logs, no plugins. JSON strings are valid YAML scalars.
 */
export function renderProxyConfig(input: { port: number; clientKey: string; managementKey: string; authDirectory: string }): string {
  const q = (value: string) => JSON.stringify(value)
  return [
    'config-version: 8',
    'server:',
    '  host: "127.0.0.1"',
    `  port: ${input.port}`,
    '  discovery:',
    '    enabled: false',
    '  kv-store:',
    '    disabled: true',
    'management:',
    '  allow-remote: false',
    `  secret-key: ${q(input.managementKey)}`,
    '  disable-control-panel: true',
    '  disable-auto-update-panel: true',
    'access:',
    '  api-keys:',
    `    - ${q(input.clientKey)}`,
    'oauth:',
    `  auth-dir: ${q(input.authDirectory)}`,
    'observability:',
    '  logs:',
    '    request-log: false',
    '    logging-to-file: false',
    '  usage:',
    '    usage-statistics-enabled: false',
    'plugins:',
    '  enabled: false',
    ''
  ].join('\n')
}

/** What the keychain keeps for one plan: CLIProxyAPI's credential files, by name, and the account they belong to. */
export type StoredPlan = { account: string | null; files: Record<string, string> }

/** Credential files only; CLIProxyAPI's own working files start with a dot. */
export function isCredentialFileName(name: string): boolean {
  return /^[A-Za-z0-9@._+-]{1,200}\.json$/.test(name) && !name.startsWith('.')
}

/** Sorts credential files into plans by the `type` CLIProxyAPI wrote; files of other providers are ignored. */
export function groupCredentialFiles(files: Record<string, string>): Record<LocalPlanProvider, StoredPlan | null> {
  const plans: Record<LocalPlanProvider, StoredPlan | null> = { claude: null, chatgpt: null }
  for (const [name, text] of Object.entries(files)) {
    if (!isCredentialFileName(name)) continue
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(text) as Record<string, unknown>
    } catch {
      continue
    }
    const plan = (Object.keys(PLAN_SIGN_IN) as LocalPlanProvider[]).find((candidate) => PLAN_SIGN_IN[candidate].credentialType === parsed.type)
    if (!plan) continue
    const current = plans[plan] ?? { account: null, files: {} }
    current.files[name] = text
    if (!current.account && typeof parsed.email === 'string' && parsed.email.trim()) current.account = parsed.email.trim().slice(0, 200)
    plans[plan] = current
  }
  return plans
}

export function parseStoredPlan(value: string | null): StoredPlan | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<StoredPlan>
    if (!parsed.files || typeof parsed.files !== 'object') return null
    const files = Object.fromEntries(Object.entries(parsed.files).filter(([name, text]) => isCredentialFileName(name) && typeof text === 'string'))
    return Object.keys(files).length ? { account: typeof parsed.account === 'string' ? parsed.account : null, files } : null
  } catch {
    return null
  }
}

const PAGE = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  '<body style="font:15px -apple-system,system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#222">' +
  `<div style="text-align:center"><p style="font-weight:600;margin:0 0 6px">${title}</p><p style="margin:0;color:#666">${body}</p></div></body>`

export type SignInCallbackServer = { close(): Promise<void> }

/**
 * Listens on this computer only, on the provider's fixed callback port, for the one redirect that carries this
 * sign-in's state, and hands the code to CLIProxyAPI. Any other request gets a 404.
 */
export async function listenForSignInCallback(input: {
  plan: LocalPlanProvider
  state: string
  proxyUrl: string
  fetch?: typeof fetch
  onCallback?: () => void
  /** Tests listen elsewhere; providers only send people back to the fixed port. */
  port?: number
}): Promise<SignInCallbackServer> {
  const { forwardPath } = PLAN_SIGN_IN[input.plan]
  const callbackPort = input.port ?? PLAN_SIGN_IN[input.plan].callbackPort
  const forward = input.fetch ?? fetch
  const handler = (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${callbackPort}`)
    if (request.method !== 'GET' || !url.pathname.endsWith('callback') || url.searchParams.get('state') !== input.state) {
      response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
      return
    }
    const failed = url.searchParams.has('error')
    void forward(`${input.proxyUrl}${forwardPath}${url.search}`, { signal: AbortSignal.timeout(10_000) })
      .catch(() => undefined)
      .finally(() => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(failed
          ? PAGE('Sign-in didn’t finish', 'Return to Overlay and try again.')
          : PAGE('You’re signed in', 'You can close this tab and return to Overlay.'))
        input.onCallback?.()
      })
  }
  const servers: Server[] = []
  const listen = (host: string) => new Promise<Server>((resolve, reject) => {
    const server = createServer(handler)
    server.once('error', reject)
    server.listen(callbackPort, host, () => resolve(server))
  })
  try {
    servers.push(await listen('127.0.0.1'))
  } catch (error) {
    throw new Error((error as NodeJS.ErrnoException).code === 'EADDRINUSE'
      ? `Another app is using port ${callbackPort} for a sign-in. Finish or close it, then try again.`
      : 'Couldn’t start the sign-in on this computer.')
  }
  // Browsers may resolve `localhost` to IPv6 first; a machine without IPv6 loopback keeps the IPv4 listener only.
  await listen('::1').then((server) => servers.push(server), () => undefined)
  return {
    close: async () => {
      await Promise.all(servers.map((server) => new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      })))
    }
  }
}

export type ManagementFetch = (path: string, init?: RequestInit) => Promise<Response>

/**
 * One sign-in: ask CLIProxyAPI for the provider's sign-in page, open it in the browser, take the redirect on this
 * computer, then wait until CLIProxyAPI has exchanged the code and written the credential.
 */
export async function runPlanSignIn(input: {
  plan: LocalPlanProvider
  proxyUrl: string
  management: ManagementFetch
  openBrowser(url: string): Promise<void>
  signal: AbortSignal
  listen?: typeof listenForSignInCallback
  pollIntervalMs?: number
  timeoutMs?: number
}): Promise<void> {
  const started = await input.management(PLAN_SIGN_IN[input.plan].authPath)
  if (!started.ok) throw new Error('Couldn’t start the sign-in.')
  const { url, state } = await started.json() as { url?: unknown; state?: unknown }
  if (typeof url !== 'string' || typeof state !== 'string' || !/^https:\/\//.test(url)) throw new Error('Couldn’t start the sign-in.')
  const server = await (input.listen ?? listenForSignInCallback)({ plan: input.plan, state, proxyUrl: input.proxyUrl })
  const deadline = Date.now() + (input.timeoutMs ?? SIGN_IN_TIMEOUT_MS)
  try {
    await input.openBrowser(url)
    for (;;) {
      if (input.signal.aborted) {
        await input.management(`/v8/management/oauth/session?state=${encodeURIComponent(state)}`, { method: 'DELETE' }).catch(() => undefined)
        throw new Error('Sign-in was cancelled.')
      }
      if (Date.now() > deadline) throw new Error('Sign-in timed out. Try again.')
      const response = await input.management(`/v0/management/get-auth-status?state=${encodeURIComponent(state)}`).catch(() => null)
      const status = response?.ok ? await response.json().catch(() => null) as { status?: string; error?: string } | null : null
      if (status?.status === 'ok') return
      if (status?.status === 'error') throw new Error('Sign-in didn’t finish. Try again.')
      await new Promise((resolve) => setTimeout(resolve, input.pollIntervalMs ?? 1_000))
    }
  } finally {
    await server.close()
  }
}
