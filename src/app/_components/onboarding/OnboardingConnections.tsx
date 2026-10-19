'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import { IntegrationsDialog } from '@/features/integrations/components/IntegrationsDialog'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { safeHttpUrl } from '@/shared/security/safe-url'
import type { OnboardingSession } from '@/shared/onboarding/session'

const tools = [
  { slug: 'gmail', name: 'Gmail', detail: 'Email and follow-ups' },
  { slug: 'outlook', name: 'Outlook', detail: 'Email and calendar' },
  { slug: 'slack', name: 'Slack', detail: 'Team context' },
  { slug: 'notion', name: 'Notion', detail: 'Docs and projects' },
  { slug: 'github', name: 'GitHub', detail: 'Code and issues' },
]

export function OnboardingConnections({ session, disabled, onContinue }: { session: OnboardingSession; disabled: boolean; onContinue(): void }) {
  const [connected, setConnected] = useState<Set<string>>(new Set())
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    const result = await overlayAppClient.integrations.get<{ connected?: string[] }>(undefined, { headers: { 'x-overlay-workspace-id': session.workspaceId }, cache: 'no-store' })
    setConnected(new Set(result.connected ?? []))
  }, [session.workspaceId])
  useEffect(() => {
    const reload = () => { void refresh().catch(() => setError('Connection status is unavailable. You can retry or continue without connecting.')) }
    reload()
    window.addEventListener('focus', reload)
    window.addEventListener('overlay:integrations-changed', reload)
    return () => { window.removeEventListener('focus', reload); window.removeEventListener('overlay:integrations-changed', reload) }
  }, [refresh])
  const connect = async (slug: string) => {
    const tab = window.open('about:blank', '_blank')
    if (tab) tab.opener = null
    setConnecting(slug)
    setError(null)
    try {
      const response = await overlayAppClient.integrations.connectResponse({ action: 'connect', providerKey: slug }, { headers: { 'x-overlay-workspace-id': session.workspaceId } })
      const result = await response.json()
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Could not start this connection.')
      const url = safeHttpUrl(result.redirectUrl)
      if (url && tab) tab.location.href = url
      else if (url) { window.open(url, '_blank', 'noopener,noreferrer') }
      else { tab?.close(); if (!result.connectionId) throw new Error('No connection setup URL was returned.') }
      await refresh()
    } catch (value) {
      tab?.close()
      setError(value instanceof Error ? value.message : 'Could not connect this tool.')
      throw value
    } finally { setConnecting(null) }
  }
  const technical = /code|software|engineer|develop|build/i.test(session.profile.about + session.profile.daily)
  const disconnect = async (slug: string) => {
    const response = await overlayAppClient.integrations.disconnectResponse(slug, { headers: { 'x-overlay-workspace-id': session.workspaceId } })
    if (!response.ok) throw new Error('Could not disconnect this tool. Please retry.')
    await refresh()
  }
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tools.filter((tool) => tool.slug !== 'github' || technical).map((tool) => (
          <Button key={tool.slug} variant="outline" disabled={disabled || Boolean(connecting) || connected.has(tool.slug)} onClick={() => { void connect(tool.slug).catch(() => {}) }} className="h-auto min-h-20 items-start gap-1 px-4 py-3 text-left whitespace-normal flex-col">
            <span className="flex w-full items-center justify-between gap-2">{tool.name}{connected.has(tool.slug) ? <Check className="size-3.5" /> : null}</span>
            <span className="text-xs font-normal text-muted-foreground">{connected.has(tool.slug) ? 'Connected' : connecting === tool.slug ? 'Opening setup...' : tool.detail}</span>
          </Button>
        ))}
        <Button variant="outline" disabled={disabled} onClick={() => setCatalogOpen(true)} className="h-auto min-h-20 gap-2"><Plus className="size-4" />More tools</Button>
      </div>
      <p className="text-xs text-muted-foreground">Optional. Review permissions in each tool before connecting.</p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2"><Button variant="ghost" disabled={disabled} onClick={onContinue}>Skip for now</Button><Button disabled={disabled} onClick={onContinue}>Continue</Button></div>
      <IntegrationsDialog isOpen={catalogOpen} onClose={() => setCatalogOpen(false)} connectedSlugs={connected} onConnect={connect} onDisconnect={disconnect} />
    </div>
  )
}
