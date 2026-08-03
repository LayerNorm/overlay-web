'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useMemo,
  type ReactNode,
} from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import dynamic from 'next/dynamic'
import type { TourStep } from '@/features/account/components/OnboardingTour'
import { useOverlayCapabilities } from '@/components/providers/CapabilitiesProvider'

const OnboardingTour = dynamic(() =>
  import('@/features/account/components/OnboardingTour').then((mod) => ({ default: mod.OnboardingTour })),
)

/** Client hint when server onboarding flag could not be persisted (cross-tab UX). */
const ONBOARDING_COMPLETE_LS_KEY = 'overlay:onboarding-completed'

function onboardingCompleteLsKey(userId: string) {
  return `${ONBOARDING_COMPLETE_LS_KEY}:${userId}`
}

const TOUR_STEPS: TourStep[] = [
  {
    target: 'model-picker',
    title: 'Talk to the best models',
    description:
      'Pick any AI model from the dropdown — or run multiple in parallel to compare answers side by side.',
    placement: 'right',
  },
  {
    target: 'generation-mode-toggle',
    title: 'Generate images & video',
    description:
      'Switch between Text, Image, and Video generation right from the composer. The best generative models are one tap away.',
    placement: 'bottom',
  },
  {
    target: 'nav-knowledge',
    title: 'All your knowledge in one place',
    description:
      "Store memories, files, connectors, skills, and MCPs — your AI's long-term context and extensions, always at hand.",
    placement: 'right',
  },
]

interface OnboardingContextType {
  startTour: () => void
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined)

export function useOnboarding(): OnboardingContextType {
  const ctx = useContext(OnboardingContext)
  if (!ctx) throw new Error('useOnboarding must be used within OnboardingProvider')
  return ctx
}

async function markComplete(userId: string | undefined) {
  try {
    const res = await overlayAppClient.onboarding.completeResponse({}, { credentials: 'include' })
    if (!res.ok) return
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean }
    if (data.ok === false) return
    if (!userId) return
    try {
      localStorage.setItem(onboardingCompleteLsKey(userId), '1')
      localStorage.removeItem(ONBOARDING_COMPLETE_LS_KEY)
    } catch {
      // ignore
    }
  } catch {
    // non-fatal
  }
}

/** Simple welcome card for mobile (< md) where the sidebar is a flyout */
function MobileWelcomeCard({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.55)' }}
      aria-hidden
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-6 left-4 right-4 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-5 shadow-2xl"
      >
        <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">Welcome to Overlay</h3>
        <ul className="mb-5 space-y-1.5 text-xs text-[var(--muted)]">
          <li>💬 <strong className="text-[var(--foreground)]">Chat</strong> — talk to the best models, or multiple at once</li>
          <li>🎨 <strong className="text-[var(--foreground)]">Generate</strong> — images & video with best-in-class models</li>
          <li>🧠 <strong className="text-[var(--foreground)]">Knowledge</strong> — memories, files, connectors, skills & MCPs</li>
        </ul>
        <button
          type="button"
          onClick={onDismiss}
          className="w-full rounded-md bg-[var(--foreground)] py-2 text-xs font-medium text-[var(--background)] transition-opacity hover:opacity-80"
        >
          Get started
        </button>
      </div>
    </div>
  )
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const { capabilities } = useOverlayCapabilities()
  const tourSteps = useMemo(
    () => capabilities.files
      ? TOUR_STEPS
      : TOUR_STEPS.filter((step) => step.target !== 'nav-knowledge'),
    [capabilities.files],
  )
  const [active, setActive] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [isMobile, setIsMobile] = useState(false)
  const checkedRef = useRef(false)
  const prevUserIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (user?.id !== prevUserIdRef.current) {
      prevUserIdRef.current = user?.id
      checkedRef.current = false
    }
  }, [user?.id])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    if (isLoading || !isAuthenticated || !user?.id || checkedRef.current) return
    checkedRef.current = true

    const params = new URLSearchParams(window.location.search)
    const fromCallback = params.get('onboarding') === '1'
    const uid = user.id

    if (fromCallback) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentStep(0)
      setActive(true)
      return
    }

    try {
      if (localStorage.getItem(onboardingCompleteLsKey(uid)) === '1') {
        return
      }
      if (localStorage.getItem(ONBOARDING_COMPLETE_LS_KEY) === '1') {
        return
      }
    } catch {
      // ignore
    }

    // Check server flag for returning users on fresh page loads
    void (async () => {
      try {
        const res = await overlayAppClient.onboarding.statusResponse({ credentials: 'include' })
        if (!res.ok) return
        const data = await res.json() as { hasSeenOnboarding: boolean }
        if (data.hasSeenOnboarding) {
          try {
            localStorage.setItem(onboardingCompleteLsKey(uid), '1')
            localStorage.removeItem(ONBOARDING_COMPLETE_LS_KEY)
          } catch {
            // ignore
          }
          return
        }
        setCurrentStep(0)
        setActive(true)
      } catch {
        // non-fatal
      }
    })()
  }, [isLoading, isAuthenticated, user?.id, pathname])

  // Replay from settings: ?tour=replay can arrive at any time (no checkedRef guard)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (!isAuthenticated || params.get('tour') !== 'replay') return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentStep(0)
    setActive(true)
  }, [isAuthenticated, pathname])

  const startTour = useCallback(() => {
    setCurrentStep(0)
    setActive(true)
  }, [])

  const closeTour = useCallback(() => {
    if (currentStep === 0) {
      window.dispatchEvent(new Event('overlay:tour:close-model-picker'))
    }
    setIsClosing(true)
    void markComplete(user?.id)
    setTimeout(() => {
      setActive(false)
      setIsClosing(false)
    }, 220)
  }, [currentStep, user?.id])

  // Steps 0 and 1 require /app/chat (model picker + generation mode toggle).
  const CHAT_PATH = '/app/chat'
  const navigateForStep = useCallback(
    (step: number) => {
      if ((step === 0 || step === 1) && !pathname?.startsWith(CHAT_PATH)) {
        router.push(CHAT_PATH)
      }
    },
    [pathname, router],
  )

  // Dispatch model picker open/close events when entering/leaving step 0.
  const handleNext = useCallback(() => {
    const next = currentStep + 1
    if (currentStep === 0) {
      window.dispatchEvent(new Event('overlay:tour:close-model-picker'))
    }
    if (next === 0) {
      window.dispatchEvent(new Event('overlay:tour:open-model-picker'))
    }
    navigateForStep(next)
    setCurrentStep(next)
  }, [currentStep, navigateForStep])

  const handleBack = useCallback(() => {
    const prev = currentStep - 1
    if (currentStep === 0) {
      window.dispatchEvent(new Event('overlay:tour:close-model-picker'))
    }
    if (prev === 0) {
      window.dispatchEvent(new Event('overlay:tour:open-model-picker'))
    }
    navigateForStep(prev)
    setCurrentStep(prev)
  }, [currentStep, navigateForStep])

  return (
    <OnboardingContext.Provider value={{ startTour }}>
      {children}
      {active && isMobile && (
        <MobileWelcomeCard onDismiss={closeTour} />
      )}
      {(active || isClosing) && !isMobile && (
        <OnboardingTour
          steps={tourSteps}
          currentStep={currentStep}
          onNext={handleNext}
          onBack={handleBack}
          onSkip={closeTour}
          onDone={closeTour}
          isClosing={isClosing}
          memoryEnabled={capabilities.memory}
          integrationsEnabled={capabilities.integrations}
        />
      )}
    </OnboardingContext.Provider>
  )
}
