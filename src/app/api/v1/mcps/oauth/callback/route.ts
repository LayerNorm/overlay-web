import { NextResponse, type NextRequest } from 'next/server'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getOverlaySession } from '@/server/auth/session'
import { enforceRateLimits, getClientIp } from '@/server/security/rate-limit'
import { getEndpointRateLimitSpecs } from '@/server/security/rate-limit-specs'
import { logger } from '@/server/observability/logger'
import { getBaseUrl } from '@/server/web/app-url'
import {
  completeMcpOAuth,
  hashSessionBinding,
  MCP_OAUTH_CONFIRM_COOKIE,
  openOAuthConfirmation,
  sealOAuthConfirmation,
} from '@/server/tools/mcp-oauth'
import { refreshMcpServerToolCatalog } from '@/server/tools/mcp-tools'

/**
 * OAuth redirect target for MCP Connect.
 *
 * This route intentionally does NOT go through handleBffRoute. The caller is a browser redirect
 * from a third-party authorization server: on desktop that browser may have no Overlay session at
 * all, and the BFF wrapper would 401 before we could consume the flow. Authorization comes instead
 * from the single-use `state` record, which is bound to a user and an MCP server when the flow
 * starts and is deleted the moment it is read.
 */

const DESKTOP_CALLBACK = 'overlay://auth/mcp-callback'
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const

function settingsUrl(params: Record<string, string>): string {
  const url = new URL('/app/tools', getBaseUrl())
  url.searchParams.set('view', 'mcps')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

function desktopUrl(params: Record<string, string>): string {
  // Fixed literal target; only our own status fields are appended, never tokens or codes.
  const url = new URL(DESKTOP_CALLBACK)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

function failure(surface: 'web' | 'desktop', reason: string): NextResponse {
  return NextResponse.redirect(
    surface === 'desktop'
      ? desktopUrl({ status: 'error', reason })
      : settingsUrl({ mcpOAuth: 'error', reason }),
    { headers: NO_STORE },
  )
}

export async function GET(request: NextRequest) {
  // handleBffRoute normally applies these; this route opts out of the wrapper, so enforce here or
  // the endpoint would be an unauthenticated, unlimited entry point.
  const rateLimited = await enforceRateLimits(
    request,
    getEndpointRateLimitSpecs({
      ip: getClientIp(request),
      method: request.method,
      pathname: request.nextUrl.pathname,
      userId: 'anonymous',
    }),
  ).catch((_error) => null)
  if (rateLimited) return rateLimited

  const params = request.nextUrl.searchParams
  const state = params.get('state')?.trim()
  const code = params.get('code')?.trim()
  const providerError = params.get('error')?.trim()

  if (!state) {
    return NextResponse.redirect(settingsUrl({ mcpOAuth: 'error', reason: 'missing_state' }), {
      headers: NO_STORE,
    })
  }

  // Consuming first means a replayed state can never be used twice, even on the error paths below.
  const serverContext = getOverlayServerContext()
  const repository = serverContext.appData.repositories.mcpServers
  const session = await repository.consumeOAuthSession({ sessionId: state }).catch((_error) => null)
  if (!session) {
    return NextResponse.redirect(settingsUrl({ mcpOAuth: 'error', reason: 'expired_state' }), {
      headers: NO_STORE,
    })
  }
  await serverContext.auditService.record({
    action: 'mcp.oauth.callback.consumed',
    actorType: 'system',
    actorUserId: session.userId,
    ipAddress: getClientIp(request),
    metadata: { surface: session.surface },
    outcome: 'success',
    resourceId: session.mcpServerId,
    resourceType: 'mcp_server',
  }).catch((error) => {
    logger.warn('[MCP] OAuth callback audit write failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    })
  })

  if (providerError) {
    logger.warn('[MCP] OAuth provider returned an error', { providerError })
    await repository.updateOAuthState({
      error: `The authorization server reported: ${providerError}`,
      mcpServerId: session.mcpServerId,
      status: 'needs_reauth',
      userId: session.userId,
    }).catch((_error) => undefined)
    return failure(session.surface, 'denied')
  }

  if (!code) return failure(session.surface, 'missing_code')

  /**
   * When the flow began in an authenticated browser we bound it to that user. Re-check it here so
   * a leaked authorization URL cannot be completed by a different signed-in account. An
   * unauthenticated browser (the desktop path) has nothing to compare and is allowed through — the
   * session record is what establishes ownership there.
   */
  if (session.sessionBindingHash) {
    const current = await getOverlaySession(request).catch((_error) => null)
    if (current?.user?.id && hashSessionBinding(current.user.id) !== session.sessionBindingHash) {
      logger.warn('[MCP] OAuth callback rejected: session binding mismatch')
      return failure(session.surface, 'account_mismatch')
    }
  }

  const server = await repository.get({
    mcpServerId: session.mcpServerId,
    userId: session.userId,
  })
  if (!server) return failure(session.surface, 'server_missing')

  // Desktop has no session cookie to bind against, so ask the human before exchanging anything.
  if (session.surface === 'desktop') {
    const response = new NextResponse(confirmationPage(server.name, server.url), {
      headers: { ...NO_STORE, 'Content-Type': 'text/html; charset=utf-8' },
    })
    response.cookies.set(
      MCP_OAUTH_CONFIRM_COOKIE,
      sealOAuthConfirmation({
        authorizationCode: code,
        codeVerifier: session.codeVerifier,
        mcpServerId: session.mcpServerId,
        userId: session.userId,
      }),
      {
        httpOnly: true,
        maxAge: 300,
        path: '/api/v1/mcps/oauth/callback',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      },
    )
    return response
  }

  try {
    await completeMcpOAuth({
      authorizationCode: code,
      baseUrl: getBaseUrl(),
      codeVerifier: session.codeVerifier,
      server,
    })
  } catch (error) {
    logger.warn('[MCP] OAuth token exchange failed', {
      mcpServerId: session.mcpServerId,
      reason: error instanceof Error ? error.message : 'unknown',
    })
    await repository.updateOAuthState({
      error: 'The authorization code could not be exchanged for tokens',
      mcpServerId: session.mcpServerId,
      status: 'needs_reauth',
      userId: session.userId,
    }).catch((_error) => undefined)
    return failure(session.surface, 'exchange_failed')
  }

  // Now that we hold tokens, populate the tool catalog so chat can use the server immediately.
  await refreshMcpServerToolCatalog({
    mcpServerId: session.mcpServerId,
    userId: session.userId,
  }).catch((_error) => undefined)

  return NextResponse.redirect(
    session.returnTo
      ? new URL(session.returnTo, getBaseUrl()).toString()
      : settingsUrl({ mcpOAuth: 'connected' }),
    { headers: NO_STORE },
  )
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character] ?? character))
}

/**
 * Desktop consent gate. The state has already been consumed at this point, so this page cannot be
 * replayed; the pending exchange lives in a sealed, short-lived cookie and only completes when the
 * person in front of the browser confirms this exact server.
 */
function confirmationPage(serverName: string, serverUrl: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect ${escapeHtml(serverName)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0b0b0c; color:#f4f4f5;
         font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; padding:24px; }
  .card { width:100%; max-width:420px; background:#151517; border:1px solid #262629; border-radius:12px; padding:24px; }
  h1 { margin:0 0 8px; font-size:16px; font-weight:600; }
  p { margin:0 0 6px; font-size:13px; color:#a1a1aa; }
  .url { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; color:#d4d4d8;
         background:#0b0b0c; border:1px solid #262629; border-radius:6px; padding:8px 10px; margin:14px 0 18px;
         overflow-wrap:anywhere; }
  button { width:100%; padding:10px 16px; font-size:13px; font-weight:500; color:#0b0b0c; background:#f4f4f5;
           border:0; border-radius:8px; cursor:pointer; }
  button:hover { background:#e4e4e7; }
</style></head>
<body><div class="card">
  <h1>Connect ${escapeHtml(serverName)} to Overlay?</h1>
  <p>Overlay will store an authorized session for this MCP server and use it to run tools on your behalf.</p>
  <div class="url">${escapeHtml(serverUrl)}</div>
  <form method="post"><button type="submit">Connect and return to Overlay</button></form>
</div></body></html>`
}

/** Completes a desktop flow the user has explicitly confirmed. */
export async function POST(request: NextRequest) {
  const pending = openOAuthConfirmation(request.cookies.get(MCP_OAUTH_CONFIRM_COOKIE)?.value)
  if (!pending) {
    return NextResponse.redirect(desktopUrl({ reason: 'expired_state', status: 'error' }), {
      headers: NO_STORE,
    })
  }

  const clearCookie = (response: NextResponse) => {
    response.cookies.set(MCP_OAUTH_CONFIRM_COOKIE, '', { maxAge: 0, path: '/' })
    return response
  }

  const repository = getOverlayServerContext().appData.repositories.mcpServers
  const server = await repository.get({
    mcpServerId: pending.mcpServerId,
    userId: pending.userId,
  })
  if (!server) {
    return clearCookie(NextResponse.redirect(
      desktopUrl({ reason: 'server_missing', status: 'error' }),
      { headers: NO_STORE },
    ))
  }

  try {
    await completeMcpOAuth({
      authorizationCode: pending.authorizationCode,
      baseUrl: getBaseUrl(),
      codeVerifier: pending.codeVerifier,
      server,
    })
  } catch (error) {
    logger.warn('[MCP] OAuth token exchange failed on desktop confirmation', {
      mcpServerId: pending.mcpServerId,
      reason: error instanceof Error ? error.message : 'unknown',
    })
    await repository.updateOAuthState({
      error: 'The authorization code could not be exchanged for tokens',
      mcpServerId: pending.mcpServerId,
      status: 'needs_reauth',
      userId: pending.userId,
    }).catch((_error) => undefined)
    return clearCookie(NextResponse.redirect(
      desktopUrl({ reason: 'exchange_failed', status: 'error' }),
      { headers: NO_STORE },
    ))
  }

  await refreshMcpServerToolCatalog({
    mcpServerId: pending.mcpServerId,
    userId: pending.userId,
  }).catch((_error) => undefined)

  return clearCookie(NextResponse.redirect(
    desktopUrl({ server: pending.mcpServerId, status: 'connected' }),
    { headers: NO_STORE },
  ))
}
