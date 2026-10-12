'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { WorkspaceSummary } from '@overlay/workspace-contracts'
import { Button, ListboxSelect, SegmentedControl } from '@overlay/ui/primitives'
import { useAuth } from '@/contexts/AuthContext'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { MCP_ACCESS_DESCRIPTION, MCP_ACCESS_LABEL, MCP_ACCESS_LEVELS, isMcpAccessLevel, type McpAccessLevel } from '@/shared/mcp/access'
import { LandingAuthPageChrome } from '@/app/auth/_components/AuthPageChrome'

type Request = { clientId: string; redirectUri: string; state: string; codeChallenge: string; scope: string }

function readRequest(params: URLSearchParams): Request | null {
  const clientId = params.get('client_id') ?? ''
  const redirectUri = params.get('redirect_uri') ?? ''
  const codeChallenge = params.get('code_challenge') ?? ''
  if (!clientId || !redirectUri || !codeChallenge) return null
  if (params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256') return null
  return { clientId, redirectUri, codeChallenge, state: params.get('state') ?? '', scope: params.get('scope') ?? '' }
}

/**
 * An app that asks for one level starts on it. Apps that list every scope they know about (Claude, the MCP SDK)
 * are not asking for the maximum, so they, and apps that name none, start on the middle level.
 */
export function initialAccess(scope: string): McpAccessLevel {
  const requested = scope.split(/\s+/).map((entry) => entry.replace(/^mcp:/, '')).filter(isMcpAccessLevel)
  return requested.length === 1 ? requested[0]! : 'write'
}

function useSignInRedirect() {
  const { isAuthenticated, isLoading } = useAuth()
  useEffect(() => {
    if (isLoading || isAuthenticated) return
    const back = `${window.location.pathname}${window.location.search}`
    window.location.replace(`/auth/sign-in?redirect=${encodeURIComponent(back)}`)
  }, [isAuthenticated, isLoading])
  return { ready: isAuthenticated && !isLoading }
}

export function AuthorizeClient() {
  const params = useSearchParams()
  const request = readRequest(new URLSearchParams(params.toString()))
  const { ready } = useSignInRedirect()
  const [client, setClient] = useState<{ name: string; redirectHost: string } | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [access, setAccess] = useState<McpAccessLevel>(() => initialAccess(request?.scope ?? ''))
  const [error, setError] = useState<string | null>(request ? null : 'This connection request is incomplete or not valid.')
  const [busy, setBusy] = useState(false)

  const clientId = request?.clientId
  const redirectUri = request?.redirectUri
  useEffect(() => {
    if (!ready || !clientId || !redirectUri) return
    let cancelled = false
    void Promise.all([
      overlayAppClient.mcpAccess.describeClient({ clientId, redirectUri }),
      overlayAppClient.workspaces.list(),
    ]).then(([described, list]) => {
      if (cancelled) return
      setClient(described)
      setWorkspaces(list.workspaces)
      setWorkspaceId(list.activeWorkspaceId || list.workspaces[0]?.id || '')
    }, (loadError: unknown) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load this request.')
    })
    return () => { cancelled = true }
  }, [ready, clientId, redirectUri])

  const decide = async (decision: 'approve' | 'deny') => {
    if (!request || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await overlayAppClient.mcpAccess.authorize({
        clientId: request.clientId, redirectUri: request.redirectUri, decision,
        ...(request.state ? { state: request.state } : {}),
        ...(decision === 'approve' ? { workspaceId, access, codeChallenge: request.codeChallenge } : {}),
      })
      window.location.assign(result.redirectUrl)
    } catch (decideError) {
      setError(decideError instanceof Error ? decideError.message : 'Could not complete the connection.')
      setBusy(false)
    }
  }

  return (
    <LandingAuthPageChrome>
      {error && !client ? (
        <div>
          <h1 className="font-serif text-2xl text-[var(--foreground)]">Can&rsquo;t connect</h1>
          <p role="alert" className="mt-3 text-sm leading-6 text-[var(--muted)]">{error}</p>
        </div>
      ) : !client ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : (
        <div className="space-y-6">
          <div>
            <h1 className="font-serif text-2xl leading-snug text-[var(--foreground)]">{client.name} wants to use your Overlay workspace</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">After you allow it, you&rsquo;ll go back to {client.redirectHost || client.name}. You can disconnect it any time in Settings → Connected apps.</p>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-[var(--foreground)]">Workspace</p>
            <ListboxSelect
              aria-label="Workspace"
              value={workspaceId}
              options={workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name }))}
              onChange={setWorkspaceId}
            />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-[var(--foreground)]">What it can do</p>
            <SegmentedControl
              ariaLabel="Access"
              layout="stretch"
              value={access}
              options={MCP_ACCESS_LEVELS.map((level) => ({ value: level, label: MCP_ACCESS_LABEL[level] }))}
              onChange={setAccess}
            />
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{MCP_ACCESS_DESCRIPTION[access]}</p>
          </div>
          {error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => void decide('deny')}>Cancel</Button>
            <Button variant="primary" className="flex-1" disabled={busy || !workspaceId} onClick={() => void decide('approve')}>{busy ? 'Connecting…' : 'Allow'}</Button>
          </div>
        </div>
      )}
    </LandingAuthPageChrome>
  )
}
