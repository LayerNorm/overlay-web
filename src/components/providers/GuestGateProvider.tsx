'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { SignInFullScreenModal } from '@/features/auth/components/SignInFullScreenModal'
import { SignInCornerPopover } from '@/features/auth/components/SignInCornerPopover'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'

export type GateReason = 'send' | 'nav' | 'history' | 'settings'

interface GuestGateContextType {
  requireAuth: (reason: GateReason) => void
  isModalOpen: boolean
}

const GuestGateContext = createContext<GuestGateContextType | undefined>(undefined)

const CORNER_DISMISSED_KEY = 'overlay:corner-dismissed'

function readCornerDismissed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return sessionStorage.getItem(CORNER_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

const FADE_MS = 200

export function GuestGateProvider({
  children,
  suppressPrompts = false,
}: {
  children: ReactNode
  suppressPrompts?: boolean
}) {
  const { user, isLoading } = useAuth()
  const isAuthenticated = Boolean(user)
  const authSettled = !isLoading
  const { capabilities } = useOverlayCapabilities()
  const pathname = usePathname()
  const [modalReason, setModalReason] = useState<GateReason | null>(null)
  const [modalClosing, setModalClosing] = useState(false)
  const [cornerDismissed, setCornerDismissed] = useState(readCornerDismissed)
  const [cornerClosing, setCornerClosing] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (!suppressPrompts && authSettled && !isAuthenticated && params.get('signin') === 'nav') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setModalReason('nav')
    }
  }, [authSettled, isAuthenticated, pathname, suppressPrompts])

  const requireAuth = useCallback(
    (reason: GateReason) => {
      if (!suppressPrompts && authSettled && !isAuthenticated) setModalReason(reason)
    },
    [authSettled, isAuthenticated, suppressPrompts],
  )

  const closeModal = useCallback(() => {
    setModalClosing(true)
    setTimeout(() => {
      setModalReason(null)
      setModalClosing(false)
    }, FADE_MS)
  }, [])

  const dismissCorner = useCallback(() => {
    setCornerClosing(true)
    setTimeout(() => {
      try { sessionStorage.setItem(CORNER_DISMISSED_KEY, '1') } catch { /* ignore */ }
      setCornerDismissed(true)
      setCornerClosing(false)
    }, FADE_MS)
  }, [])

  const showCorner =
    !suppressPrompts && authSettled && !isAuthenticated && !cornerDismissed && !modalReason

  return (
    <GuestGateContext.Provider value={{ requireAuth, isModalOpen: !!modalReason }}>
      {children}
      {!isAuthenticated && (((authSettled && !!modalReason) || modalClosing)) ? (
        <SignInFullScreenModal
          reason={modalReason ?? 'nav'}
          onClose={closeModal}
          isClosing={modalClosing}
          ssoEnabled={capabilities.sso}
        />
      ) : null}
      {(showCorner || cornerClosing) ? (
        <SignInCornerPopover
          onDismiss={dismissCorner}
          isClosing={cornerClosing}
          ssoEnabled={capabilities.sso}
        />
      ) : null}
    </GuestGateContext.Provider>
  )
}

export function useGuestGate(): GuestGateContextType {
  const ctx = useContext(GuestGateContext)
  if (!ctx) throw new Error('useGuestGate must be used within GuestGateProvider')
  return ctx
}
