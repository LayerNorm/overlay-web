'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import { buildWorkspaceHref } from '@/shared/workspaces/routing'
import styles from './onboarding.module.css'

const stops = [
  { anchor: 'nav-work', title: 'Work', description: 'Your first task is here. Create tasks and assign them to AI employees or people.' },
  { anchor: 'nav-agents', title: 'Agents', description: 'Your AI employees live here. Manage their responsibilities and connections.' },
  { anchor: 'nav-chat', title: 'Chats', description: 'Talk with your teammates and AI employees. Your onboarding conversation stays here, too.' },
  { anchor: 'nav-automations', title: 'Automations', description: 'Run recurring work on a schedule.' },
  { anchor: 'nav-more', title: 'Files and extensions', description: 'Open More to find saved files and connect other tools.' },
  { anchor: 'nav-work', title: 'Happy working.', description: 'Your first task is ready. Open it to choose an assignee and take the next step.' },
]

export function OnboardingTour({ workspaceId, taskId, onClose }: { workspaceId: string; taskId: string; onClose(): void }) {
  const [index, setIndex] = useState(0)
  const router = useRouter()
  const stop = stops[index]!
  useEffect(() => {
    const targets = [...document.querySelectorAll<HTMLElement>(`[data-tour="${stop.anchor}"]`)]
    const target = targets.find((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0)
    target?.classList.add(styles.highlight!)
    return () => target?.classList.remove(styles.highlight!)
  }, [stop.anchor])
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', dismiss)
    return () => window.removeEventListener('keydown', dismiss)
  }, [onClose])
  const finish = () => { router.push(`${buildWorkspaceHref(workspaceId, '/app/work')}?task=${encodeURIComponent(taskId)}&scope=personal`); onClose() }
  return <section role="region" aria-label="Workspace tour" className="fixed right-4 bottom-4 left-4 z-50 max-w-sm rounded-xl border bg-background p-5 shadow-lg sm:left-auto">
    <Button variant="ghost" size="icon" aria-label="Dismiss tour" onClick={onClose} className="absolute top-2 right-2 size-7"><X className="size-4" /></Button>
    <div aria-live="polite"><p className="mb-2 text-xs text-muted-foreground">{index + 1} of {stops.length}</p><h2 className="font-medium">{stop.title}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{stop.description}</p></div>
    <div className="mt-4 flex justify-end gap-2">{index > 0 ? <Button variant="ghost" size="sm" onClick={() => setIndex((value) => value - 1)}>Back</Button> : <Button variant="ghost" size="sm" onClick={onClose}>Skip tour</Button>}<Button size="sm" onClick={() => index === stops.length - 1 ? finish() : setIndex((value) => value + 1)}>{index === stops.length - 1 ? 'Start working' : 'Next'}</Button></div>
  </section>
}
