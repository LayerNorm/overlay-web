'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, SquareArrowOutUpRight } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import type { DesktopBridge } from '@overlay/desktop-bridge'
import { BrandLockup } from '@/components/brand/BrandLockup'
import { loadDesktopBridgeContract } from '@/components/desktop/desktop-bridge-loader'
import { requestSessionState } from '@/shared/auth/browser-session'
import { ROOT_APP_DESTINATION } from '@/shared/auth/root-entry'

type Phase = 'checking' | 'signed-out' | 'waiting' | 'opening'

/**
 * The desktop app's signed-out screen: the loading screen's wordmark and line,
 * settled into a way back in. Signing in happens in the browser and returns
 * through the app's own sign-in handoff, which replaces this page.
 */
export function DesktopHome() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('checking')
  const [bridge, setBridge] = useState<DesktopBridge | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      const contract = loadDesktopBridgeContract()
      const desktop = contract ? (await contract.catch(() => null))?.getDesktopBridge() ?? null : null
      const info = desktop ? await desktop.handshake().catch(() => null) : null
      if (!active) return
      // Outside the app, or an app that cannot start sign-in: the website's sign-in works everywhere.
      if (!desktop || !info?.capabilities.includes('auth')) {
        router.replace('/auth/sign-in')
        return
      }
      setBridge(desktop)
      setVersion(info.appVersion)
      const session = await requestSessionState()
      if (!active) return
      if (session.status === 'authenticated') {
        setPhase('opening')
        router.replace(ROOT_APP_DESTINATION)
      } else {
        setPhase('signed-out')
      }
    })()
    return () => { active = false }
  }, [router])

  const signIn = () => {
    if (!bridge) return
    setError(null)
    setPhase('waiting')
    void bridge.call('auth.signIn', {}).catch(() => {
      setPhase('signed-out')
      setError('Could not open your browser. Try again.')
    })
  }

  const busy = phase === 'checking' || phase === 'opening'

  return (
    <div className="relative flex h-screen flex-col items-center justify-center overflow-hidden bg-background px-6 text-foreground">
      <div className="desktop-home-drag absolute inset-x-0 top-0 h-10" aria-hidden />
      <BrandLockup className="app-brand-loader-lockup" motion="look" />
      <div className="mt-[30px] flex min-h-[21px] items-center justify-center text-sm text-muted" role="status" aria-live="polite">
        {phase === 'waiting' ? (
          <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />Finish signing in in your browser&hellip;</span>
        ) : phase === 'opening' ? (
          <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />Opening Workspace&hellip;</span>
        ) : (
          <span>Your AI Chief of Staff.</span>
        )}
      </div>

      {phase === 'signed-out' ? (
        <div className="desktop-home-enter mt-7 flex w-[260px] flex-col items-center">
          <Button variant="primary" className="w-full" onClick={signIn}>Sign in</Button>
          <p className="mt-4 text-center text-xs text-(--muted-light)" role={error ? 'alert' : undefined}>
            {error ?? 'Opens in your browser, then brings you back here.'}
          </p>
        </div>
      ) : null}

      {phase === 'waiting' ? (
        <div className="desktop-home-enter mt-7 flex w-[260px] flex-col gap-2">
          <Button variant="secondary" className="w-full" onClick={signIn}>
            <SquareArrowOutUpRight size={16} strokeWidth={1.75} />Open browser again
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => setPhase('signed-out')}>Cancel</Button>
        </div>
      ) : null}

      {!busy ? (
        <div className="absolute inset-x-0 bottom-4 flex flex-col items-center gap-3 text-center">
          {phase === 'signed-out' ? (
            <p className="desktop-home-enter text-[13px] text-muted">
              New to Overlay?{' '}
              <Button variant="link" className="text-[13px]" onClick={signIn}>Create an account</Button>
            </p>
          ) : null}
          {version ? <p className="text-xs text-(--muted-light)">Overlay {version}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
