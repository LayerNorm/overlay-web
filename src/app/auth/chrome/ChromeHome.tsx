'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import { BrandLockup } from '@/components/brand/BrandLockup'
import { isChromeExtensionFrame } from '@/components/chrome/chrome-extension'
import { requestSessionState } from '@/shared/auth/browser-session'
import { ROOT_APP_DESTINATION } from '@/shared/auth/root-entry'

type Phase = 'checking' | 'signed-out' | 'waiting' | 'opening'

const SIGN_IN_HREF = `/auth/sign-in?redirect=${encodeURIComponent(ROOT_APP_DESTINATION)}`
const SIGN_UP_HREF = `/auth/sign-up?redirect=${encodeURIComponent(ROOT_APP_DESTINATION)}`
const POLL_MS = 2_000

const signedIn = async () => (await requestSessionState().catch(() => null))?.status === 'authenticated'

/**
 * The Chrome side panel's signed-out screen. Sign-in cannot run inside the panel's frame, so it opens in a normal
 * tab; the panel shares that tab's session and opens the app as soon as it exists.
 */
export function ChromeHome() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('checking')

  const open = useCallback(() => {
    setPhase('opening')
    router.replace(ROOT_APP_DESTINATION)
  }, [router])

  const check = useCallback(() => {
    void signedIn().then((yes) => { if (yes) open() })
  }, [open])

  useEffect(() => {
    // Outside the side panel, the website's sign-in works everywhere.
    if (!isChromeExtensionFrame()) {
      router.replace('/auth/sign-in')
      return
    }
    void signedIn().then((yes) => (yes ? open() : setPhase('signed-out')))
  }, [open, router])

  useEffect(() => {
    if (phase !== 'waiting') return
    const timer = window.setInterval(check, POLL_MS)
    window.addEventListener('focus', check)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
    }
  }, [check, phase])

  const busy = phase === 'checking' || phase === 'opening'

  return (
    <div className="relative flex h-screen flex-col items-center justify-center overflow-hidden bg-background px-6 text-foreground">
      <BrandLockup className="app-brand-loader-lockup" motion="look" />
      <div className="mt-[30px] flex min-h-[21px] items-center justify-center text-sm text-(--muted)" role="status" aria-live="polite">
        {phase === 'waiting' ? (
          <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />Finish signing in in the new tab&hellip;</span>
        ) : phase === 'opening' ? (
          <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />Opening Workspace&hellip;</span>
        ) : (
          <span>Your AI Chief of Staff.</span>
        )}
      </div>

      {phase === 'signed-out' || phase === 'waiting' ? (
        <div className="desktop-home-enter mt-7 flex w-full max-w-[260px] flex-col items-center">
          <Button asChild variant={phase === 'waiting' ? 'secondary' : 'primary'} className="w-full">
            <a href={SIGN_IN_HREF} target="_blank" rel="noopener noreferrer" onClick={() => setPhase('waiting')}>
              {phase === 'waiting' ? 'Open sign-in again' : 'Sign in'}
            </a>
          </Button>
          <p className="mt-4 text-center text-xs text-(--muted-light)">Opens in a new tab, then comes back here.</p>
        </div>
      ) : null}

      {!busy ? (
        <p className="desktop-home-enter absolute inset-x-0 bottom-4 text-center text-[13px] text-(--muted)">
          New to Overlay?{' '}
          <Button asChild variant="link" className="text-[13px]">
            <a href={SIGN_UP_HREF} target="_blank" rel="noopener noreferrer" onClick={() => setPhase('waiting')}>Create an account</a>
          </Button>
        </p>
      ) : null}
    </div>
  )
}
