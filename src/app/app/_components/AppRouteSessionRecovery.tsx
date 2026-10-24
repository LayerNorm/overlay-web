'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { requestSessionState } from '@/shared/auth/browser-session'
import { ChatRouteSkeleton } from './AppRouteSkeletons'

export async function recoverAppRouteSession(actions: {
  isCurrent: () => boolean
  refresh: () => void
  signIn: () => void
}): Promise<void> {
  const session = await requestSessionState()
  if (!actions.isCurrent()) return
  if (session.status === 'authenticated') actions.refresh()
  else if (session.status === 'unauthenticated') actions.signIn()
  else throw new Error('Unable to refresh your session. Please try again.')
}

export function AppRouteSessionRecovery() {
  const router = useRouter()
  const [failed, setFailed] = useState(false)
  const [refreshed, setRefreshed] = useState(false)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    let active = true
    void recoverAppRouteSession({
      isCurrent: () => active,
      refresh: () => startTransition(() => {
        router.refresh()
        setRefreshed(true)
      }),
      signIn: () => router.replace('/app/chat?signin=nav'),
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [router])

  // Do not repeatedly refresh if the server still cannot authenticate the page.
  if (failed || (refreshed && !pending)) {
    throw new Error('Unable to refresh your session. Please try again.')
  }
  return <ChatRouteSkeleton />
}
