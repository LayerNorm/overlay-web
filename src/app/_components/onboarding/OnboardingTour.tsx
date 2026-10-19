'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import { buildWorkspaceHref } from '@/shared/workspaces/routing'
import { getMobileTourHost, setTourNavigationOpen, subscribeToMobileTourHost } from '@/components/layout/sidebar/tour-navigation'
import styles from './onboarding.module.css'

const stops = [
  { anchor: 'nav-work', title: 'Work', description: 'Your first task is here. Create tasks and assign them to AI employees or people.' },
  { anchor: 'nav-agents', title: 'Agents', description: 'Your AI employees live here. Manage their responsibilities and connections.' },
  { anchor: 'nav-chat', title: 'Chats', description: 'Talk with your teammates and AI employees. Your onboarding conversation stays here, too.' },
  { anchor: 'nav-automations', title: 'Automations', description: 'Run recurring work on a schedule.' },
  { anchor: 'nav-more', title: 'Files and extensions', description: 'Find saved files and connect other tools here.' },
  { anchor: 'nav-work', title: 'Happy working.', description: 'Your first task is ready. Open it to choose an assignee and take the next step.' },
]

export function OnboardingTour({ workspaceId, taskId, onClose }: { workspaceId: string; taskId: string; onClose(): void }) {
  const [index, setIndex] = useState(0)
  const router = useRouter()
  const stop = stops[index]!
  const mobileHost = useSyncExternalStore(subscribeToMobileTourHost, getMobileTourHost, () => null)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const update = () => setTourNavigationOpen(media.matches)
    update()
    media.addEventListener('change', update)
    return () => { media.removeEventListener('change', update); setTourNavigationOpen(false) }
  }, [])
  useEffect(() => {
    const anchors = stop.anchor === 'nav-more' ? ['nav-more', 'nav-knowledge', 'nav-files', 'nav-extensions'] : [stop.anchor]
    const targets = [...document.querySelectorAll<HTMLElement>(anchors.map((anchor) => `[data-tour="${anchor}"]`).join(','))]
    const target = targets.find((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0)
    target?.classList.add(styles.highlight!)
    target?.scrollIntoView({ block: 'nearest' })
    return () => target?.classList.remove(styles.highlight!)
  }, [stop.anchor, mobileHost])
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', dismiss)
    return () => window.removeEventListener('keydown', dismiss)
  }, [onClose])
  const finish = () => { router.push(`${buildWorkspaceHref(workspaceId, '/app/work')}?task=${encodeURIComponent(taskId)}&scope=personal`); onClose() }
  const card = <section role="region" aria-label="Workspace tour" className={`${mobileHost ? 'relative m-3 shrink-0' : 'fixed right-4 bottom-4 left-4 z-50 sm:left-auto'} max-w-sm rounded-xl border bg-background p-5 shadow-lg`}>
    <Button variant="ghost" size="icon" aria-label="Dismiss tour" onClick={onClose} className="absolute top-2 right-2 size-7"><X className="size-4" /></Button>
    <div aria-live="polite"><p className="mb-2 text-xs text-muted-foreground">{index + 1} of {stops.length}</p><h2 className="font-medium">{stop.title}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{stop.description}</p></div>
    <div className="mt-4 flex justify-end gap-2">{index > 0 ? <Button variant="ghost" size="sm" onClick={() => setIndex((value) => value - 1)}>Back</Button> : <Button variant="ghost" size="sm" onClick={onClose}>Skip tour</Button>}<Button size="sm" onClick={() => index === stops.length - 1 ? finish() : setIndex((value) => value + 1)}>{index === stops.length - 1 ? 'Start working' : 'Next'}</Button></div>
  </section>
  return mobileHost ? createPortal(card, mobileHost) : card
}
