'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { Button, Popover, PopoverContent, PopoverTrigger } from '@overlay/ui/primitives'
import { useByokModels } from '@/components/providers/useByokModels'
import { isApiKeySubscriptionConnection } from '@/shared/ai/gateway/subscription-providers'
import { CHECKLIST_ITEMS, checklistVisible, readChecklist, writeChecklist, type ChecklistItemId, type ChecklistState } from './onboarding-checklist-state'
import { trackOnboarding } from './onboarding-analytics'

function ProgressRing({ value }: { value: number }) {
  const circumference = 2 * Math.PI * 7
  return <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden className="shrink-0 -rotate-90">
    <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
    <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value)} />
  </svg>
}

/** "Get started n/7" at the bottom of the primary sidebar, shown after onboarding v2 until done or dismissed. */
export function OnboardingChecklist({ workspaceId, expanded, buildHref, navigate }: {
  workspaceId: string | null
  expanded: boolean
  buildHref(href: string): string
  navigate(href: string): void
}) {
  const [state, setState] = useState<ChecklistState | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!workspaceId) return
    const sync = () => setState(readChecklist(workspaceId))
    sync()
    window.addEventListener('overlay:onboarding-checklist', sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener('overlay:onboarding-checklist', sync); window.removeEventListener('storage', sync) }
  }, [workspaceId])
  const visible = Boolean(state && checklistVisible(state))
  const { connections } = useByokModels({ enabled: visible })
  const subscribed = connections.some((connection) => (connection.providerId.startsWith('subscription:') || isApiKeySubscriptionConnection(connection)) && connection.status === 'active')
  const update = useCallback((change: (current: ChecklistState) => ChecklistState) => {
    if (!workspaceId) return
    const next = change(readChecklist(workspaceId))
    writeChecklist(workspaceId, next)
    setState(next)
  }, [workspaceId])
  if (!workspaceId || !state || !visible) return null
  // A connected subscription counts as done without being clicked.
  const done = new Set<ChecklistItemId>([...state.done, ...(subscribed ? ['subscription' as const] : [])])
  const progress = done.size / CHECKLIST_ITEMS.length
  const showTooltip = !state.tooltipSeen && !open
  const openItem = (id: ChecklistItemId, href: string | null) => {
    trackOnboarding('onboarding_checklist_item_clicked', { item: id })
    update((current) => ({ ...current, done: [...new Set<ChecklistItemId>([...current.done, id])] }))
    setOpen(false)
    if (href) navigate(href === '/download' ? href : buildHref(href))
  }
  return (
    <div className="relative px-2 pb-1">
      <Popover open={open} onOpenChange={(next) => {
        setOpen(next)
        if (next) { trackOnboarding('onboarding_checklist_opened', { done: done.size }); if (!state.tooltipSeen) update((current) => ({ ...current, tooltipSeen: true })) }
      }}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={`Get started, ${done.size} of ${CHECKLIST_ITEMS.length} done`}
            className="h-auto w-full justify-start gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-normal">
            <ProgressRing value={progress} />
            {expanded ? <><span className="flex-1">Get started</span><span className="text-xs text-muted-foreground">{done.size}/{CHECKLIST_ITEMS.length}</span></> : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent side="right" align="end" className="w-72 p-2">
          <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
            <p className="text-sm font-medium">Get started with Overlay</p>
            <Button variant="ghost" size="sm" aria-label="Hide checklist" onClick={() => { update((current) => ({ ...current, dismissed: true })); setOpen(false) }}><X size={14} /></Button>
          </div>
          <ul>
            {CHECKLIST_ITEMS.map((item) => <li key={item.id}>
              <Button variant="ghost" size="sm" disabled={!item.href && done.has(item.id)} onClick={() => openItem(item.id, item.href)}
                className="h-auto w-full justify-start gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] font-normal disabled:opacity-100">
                <span className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${done.has(item.id) ? 'border-transparent bg-(--foreground) text-(--background)' : 'border-(--border)'}`}>
                  {done.has(item.id) ? <Check size={10} strokeWidth={3} /> : null}
                </span>
                <span className={done.has(item.id) ? 'text-muted-foreground line-through' : ''}>{item.label}</span>
              </Button>
            </li>)}
          </ul>
        </PopoverContent>
      </Popover>
      {showTooltip ? <div role="status" className="absolute bottom-full left-2 z-50 mb-2 w-60 rounded-lg border border-(--border) bg-(--surface-elevated) p-3 text-xs shadow-lg">
        <p className="font-medium text-[13px]">Your setup checklist lives here</p>
        <p className="mt-1 text-muted-foreground">Invite teammates, import memories and connect your tools whenever you are ready.</p>
        <Button className="mt-2" variant="secondary" size="sm" onClick={() => update((current) => ({ ...current, tooltipSeen: true }))}>Got it</Button>
      </div> : null}
    </div>
  )
}
