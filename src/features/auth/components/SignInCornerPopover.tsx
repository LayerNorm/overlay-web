'use client'
import { unstyledButton } from '@overlay/ui/control-reset'
import { Button } from '@overlay/ui/primitives'

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
    // Anchored non-modal popover — a native <dialog> cannot anchor to the corner while leaving the page interactive.
    // react-doctor-disable-next-line react-doctor/prefer-html-dialog
    <div
      style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(6px)', transition: 'opacity 200ms ease, transform 200ms ease' }}
      className="fixed bottom-5 right-5 z-50 w-[320px] rounded-2xl border border-(--border) bg-(--surface-elevated) shadow-2xl"
      role="dialog"
      aria-label="Sign in to overlay"
    >
      <div className="flex items-start justify-between gap-2 px-5 pt-5 pb-3">
        <div className="flex items-center gap-2.5">
          <OverlayMark size={16} label="" />
          <p className="text-sm font-medium text-(--foreground)">Sign in or create an account</p>
        </div>
        <Button variant="ghost"
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className={unstyledButton(`mt-0.5 shrink-0 text-(--muted) transition-colors hover:text-(--foreground)`)}
        >
          <X size={15} />
        </Button>
      </div>
      <p className="px-5 pb-3 text-xs text-(--muted)">
        Save your chats, notes, and knowledge across sessions.
      </p>
      <div className="px-5 pb-5">
        <SignInForm redirectTo={pathname} ssoEnabled={ssoEnabled} />
      </div>
    </div>
  )
}
