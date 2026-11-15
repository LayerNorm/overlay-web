'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { safeHttpUrl } from '@/shared/security/safe-url'
import { ONBOARDING_TOOL_LABELS, type OnboardingSession } from '@/shared/onboarding/session'
import { BrandMark } from './onboarding-logos'
import { OnboardingSubscriptions } from './OnboardingSubscriptions'

type ToolSlug = keyof typeof ONBOARDING_TOOL_LABELS

const APPS: { slug: ToolSlug; detail: string; technical?: boolean }[] = [
  { slug: 'gmail', detail: 'Email and follow-ups' },
  { slug: 'googlecalendar', detail: 'Meetings and availability' },
  { slug: 'slack', detail: 'Team conversations' },
  { slug: 'notion', detail: 'Docs and projects' },
  { slug: 'github', detail: 'Code and issues', technical: true },
]

/** null while checking, false when the deployment or provider cannot connect. */
function useAvailability(workspaceId: string) {
  const { capabilities } = useOverlayCapabilities()
  const [apps, setApps] = useState<Set<string> | false | null>(capabilities.integrations ? null : false)
  const refreshApps = useCallback(async () => {
    const result = await overlayAppClient.integrations.get<{ connected?: string[] }>(undefined, { headers: { 'x-overlay-workspace-id': workspaceId }, cache: 'no-store' })
    setApps(new Set(result.connected ?? []))
  }, [workspaceId])
  useEffect(() => {
    if (!capabilities.integrations) return
    const reload = () => { void refreshApps().catch(() => setApps((current) => (current instanceof Set ? current : false))) }
    reload()
    window.addEventListener('focus', reload)
    window.addEventListener('overlay:integrations-changed', reload)
    return () => { window.removeEventListener('focus', reload); window.removeEventListener('overlay:integrations-changed', reload) }
  }, [capabilities.integrations, refreshApps])
  return { apps, refreshApps }
}

export function OnboardingTools({ session, disabled, onContinue }: {
  session: OnboardingSession
  disabled: boolean
  onContinue(result: { tools: ToolSlug[]; agentIds: string[] }): void
}) {
  const { apps, refreshApps } = useAvailability(session.workspaceId)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const technical = /engineer|code|software/i.test(`${session.profile.about} ${session.profile.daily}`)
  const visibleApps = APPS.filter((app) => !app.technical || technical)
  const connectedApps = apps instanceof Set ? visibleApps.filter((app) => apps.has(app.slug)).map((app) => app.slug) : []
  const anyConnected = connectedApps.length > 0
  const nothingAvailable = !(apps instanceof Set)
  const connect = async (slug: ToolSlug) => {
    const tab = window.open('about:blank', '_blank')
    if (tab) tab.opener = null
    setConnecting(slug)
    setError(null)
    try {
      const response = await overlayAppClient.integrations.connectResponse({ action: 'connect', providerKey: slug }, { headers: { 'x-overlay-workspace-id': session.workspaceId } })
      const result = await response.json()
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : `Could not connect ${ONBOARDING_TOOL_LABELS[slug]}.`)
      const url = safeHttpUrl(result.redirectUrl)
      if (url && tab) tab.location.href = url
      else if (url) window.open(url, '_blank', 'noopener,noreferrer')
      else { tab?.close(); if (!result.connectionId) throw new Error('No connection setup URL was returned.') }
      await refreshApps()
    } catch (value) {
      tab?.close()
      setError(value instanceof Error ? value.message : `Could not connect ${ONBOARDING_TOOL_LABELS[slug]}.`)
    } finally { setConnecting(null) }
  }
  if (apps === null) return <div><OnboardingSubscriptions disabled={disabled} /><p className="text-[13px] text-muted-foreground">Checking other connections...</p></div>
  return (
    <div>
      <OnboardingSubscriptions disabled={disabled} />
      {nothingAvailable ? <p className="text-[13px] text-muted-foreground">App connections aren&apos;t available on this deployment.</p> : null}
      {apps instanceof Set ? <>
        <ToolRows rows={visibleApps.map((app) => ({ id: app.slug, name: ONBOARDING_TOOL_LABELS[app.slug], detail: app.detail, connected: apps.has(app.slug), busy: connecting === app.slug, onConnect: () => { void connect(app.slug) } }))} disabled={disabled || Boolean(connecting)} />
      </> : null}
      {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
      <Button variant={anyConnected || nothingAvailable ? 'primary' : 'ghost'} size="sm" className="mt-3.5" disabled={disabled} onClick={() => onContinue({ tools: connectedApps, agentIds: [] })}>
        {anyConnected || nothingAvailable ? 'Continue' : 'Not now'}
      </Button>
    </div>
  )
}

type ToolRow = { id: string; name: string; detail: string; connected: boolean; busy: boolean; onConnect(): void }

function ToolRows({ rows, disabled }: { rows: ToolRow[]; disabled: boolean }) {
  return (
    <div className="divide-y divide-(--border) overflow-hidden rounded-xl border border-(--border) bg-(--surface-elevated)">
      {rows.map((row) => (
        <div key={row.id} className="flex items-center gap-3 px-3.5 py-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-(--border) bg-white dark:border-transparent">
            <BrandMark id={row.id} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium">{row.name}</span>
            <span className="block text-xs text-muted-foreground">{row.detail}</span>
          </span>
          {row.connected
            ? <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Check className="size-3.5" aria-hidden />Connected</span>
            : <Button variant="secondary" size="xs" className="h-7 px-2.5" disabled={disabled || row.busy} onClick={row.onConnect}>{row.busy ? 'Opening…' : 'Connect'}</Button>}
        </div>
      ))}
    </div>
  )
}
