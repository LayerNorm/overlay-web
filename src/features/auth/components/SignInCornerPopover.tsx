'use client'

import { useLayoutEffect, useState } from 'react'
import { X } from 'lucide-react'
import { OverlayMark } from '@/components/orb/Orb'
import { usePathname } from 'next/navigation'
import { SignInForm } from '@/features/auth/components/SignInForm'

interface Props {
  onDismiss: () => void
  isClosing?: boolean
  ssoEnabled?: boolean
}

export function SignInCornerPopover({ onDismiss, isClosing = false, ssoEnabled = true }: Props) {
  const pathname = usePathname() ?? '/app/chat'
  const [mounted, setMounted] = useState(false)

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const visible = mounted && !isClosing

  return (
    <div
      style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(6px)', transition: 'opacity 200ms ease, transform 200ms ease' }}
      className="fixed bottom-5 right-5 z-50 w-[320px] rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-2xl"
      role="dialog"
      aria-label="Sign in to overlay"
    >
      <div className="flex items-start justify-between gap-2 px-5 pt-5 pb-3">
        <div className="flex items-center gap-2.5">
          <OverlayMark size={16} label="" />
          <p className="text-sm font-medium text-[var(--foreground)]">Sign in or create an account</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="mt-0.5 shrink-0 text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
        >
          <X size={15} />
        </button>
      </div>
      <p className="px-5 pb-3 text-xs text-[var(--muted)]">
        Save your chats, notes, and knowledge across sessions.
      </p>
      <div className="px-5 pb-5">
        <SignInForm redirectTo={pathname} ssoEnabled={ssoEnabled} />
      </div>
    </div>
  )
}
