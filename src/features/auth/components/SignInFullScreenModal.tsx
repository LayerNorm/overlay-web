'use client'

import { useLayoutEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SignInForm } from '@/features/auth/components/SignInForm'
import type { GateReason } from '@/components/providers/GuestGateProvider'

const REASON_TITLES: Record<GateReason, string> = {
  send: 'Sign in to send messages',
  nav: 'Sign in to continue',
  history: 'Sign in to view your history',
  settings: 'Sign in to access settings',
}

interface Props {
  reason: GateReason
  onClose: () => void
  isClosing?: boolean
  ssoEnabled?: boolean
}

export function SignInFullScreenModal({ reason, onClose, isClosing = false, ssoEnabled = true }: Props) {
  const pathname = usePathname() ?? '/app/chat'
  const redirectTo = pathname.replace(/[?#].*$/, '')
  const [mounted, setMounted] = useState(false)

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const visible = mounted && !isClosing

  return (
    <div
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 200ms ease' }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{ transform: visible ? 'scale(1) translateY(0)' : 'scale(0.97) translateY(4px)', transition: 'transform 200ms ease' }}
        className="relative w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-8 shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
        >
          <svg
            width='15'
            height='15'
            viewBox='0 0 15 15'
            fill='none'
            aria-hidden
          >
            <path
              d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z"
              fill="currentColor"
            />
          </svg>
        </button>

        <div className="mb-6 text-center">
          <h2
            className='text-xl font-medium text-[var(--foreground)]'
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            {REASON_TITLES[reason]}
          </h2>
          <p className="mt-1.5 text-sm text-[var(--muted)]">
            By continuing, you agree to our{' '}
            <Link
              href='/terms'
              className='underline underline-offset-2 hover:text-[var(--foreground)] transition-colors'
            >
              terms of service
            </Link>
            .
          </p>
        </div>

        <SignInForm redirectTo={redirectTo} onClose={onClose} ssoEnabled={ssoEnabled} />
      </div>
    </div>
  )
}
