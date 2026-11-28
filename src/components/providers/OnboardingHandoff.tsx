'use client'

import { createContext, useContext, useEffect, type ReactNode } from 'react'

type Handoff = { conversationId: string; onReady(): void; onConversationMissing(): void }
const HandoffContext = createContext<Handoff | null>(null)

/** Keeps the finished onboarding conversation over the page it hands off to until that page has painted. */
export function OnboardingHandoff({ pending, children }: { pending: Handoff | null; children: ReactNode }) {
  return <HandoffContext.Provider value={pending}>
    <div className={pending ? 'absolute inset-0 z-0' : 'contents'} aria-hidden={Boolean(pending)} inert={Boolean(pending)}>{children}</div>
  </HandoffContext.Provider>
}

export function useOnboardingHandoffReady(conversationId: string | null, ready: boolean) {
  const pending = useContext(HandoffContext)
  useEffect(() => {
    if (!pending || !ready) return
    if (conversationId !== pending.conversationId) {
      pending.onConversationMissing()
      return
    }
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(pending.onReady) })
    return () => cancelAnimationFrame(frame)
  }, [pending, ready, conversationId])
}
