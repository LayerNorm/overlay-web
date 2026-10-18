'use client'
import { Button } from '@overlay/ui/primitives'
import { unstyledButton } from '@overlay/ui/control-reset'
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
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { isStartingWorkspaceName } from '@/shared/workspaces/default-name'
import { peopleInWorkspace } from '@/shared/workspaces/solo-workspace'
import { buildWorkspaceHref, resolveWorkspaceSurface } from '@/shared/workspaces/routing'

const NameWorkspaceStep = dynamic(() =>
  import('@/features/workspaces/components/NameWorkspaceStep').then((mod) => ({ default: mod.NameWorkspaceStep })),
)

const OnboardingTour = dynamic(() =>
  import('@/features/account/components/OnboardingTour').then((mod) => ({ default: mod.OnboardingTour })),
)

/** Client hint when server onboarding flag could not be persisted (cross-tab UX). */
const ONBOARDING_COMPLETE_LS_KEY = 'overlay:onboarding-completed'

function onboardingCompleteLsKey(userId: string) {
  return `${ONBOARDING_COMPLETE_LS_KEY}:${userId}`
}

function hasCompletionHint(userId: string): boolean {
  try {
    return localStorage.getItem(onboardingCompleteLsKey(userId)) === '1'
      || localStorage.getItem(ONBOARDING_COMPLETE_LS_KEY) === '1'
  } catch {
    return false
  }
}

function recordCompletionHint(userId: string) {
  try {
    localStorage.setItem(onboardingCompleteLsKey(userId), '1')
    localStorage.removeItem(ONBOARDING_COMPLETE_LS_KEY)
  } catch {
    // ignore
  }
}

const TOUR_STEPS: TourStep[] = [
  {
    target: 'model-picker',
    title: 'Talk to the best models',
    description:
      'Pick any AI model from the dropdown, or run several in parallel to compare answers side by side.',
    placement: 'right',
  },
  {
    // Anchors to the picker + its open panel: the generation-mode toggle only
    // exists inside the open dropdown, so pointing at the whole menu is both
    // accurate and can never dead-end when the toggle is unmounted.
    target: 'model-picker',
    title: 'Generate images & video',
    description:
      'Switch between Text, Image, and Video generation inside this menu. The best generative models are one tap away.',
    placement: 'right',
  },
  {
    // Anchors to the Files rail item: memories and connectors moved out, so the
    // copy describes what this surface actually holds (notes, files, outputs).
    target: 'nav-knowledge',
    title: 'Files and notes',
    description:
      'Uploads, notes, and everything your AI generates live here.',
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
    recordCompletionHint(userId)
  } catch {
    // non-fatal
  }
}

/** Simple welcome card for mobile (< md) where the sidebar is a flyout */
function MobileWelcomeCard({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.55)' }}
    >
      {/* Inner stopPropagation only guards future backdrop dismissal; no interactive role is claimed. */}
      {/* react-doctor-disable-next-line react-doctor/no-static-element-interactions */}
      {/* Bottom-anchored mobile welcome card — a native <dialog> cannot anchor to the viewport bottom non-modally. */}
      {/* react-doctor-disable-next-line react-doctor/prefer-html-dialog */}
      <div
        role="dialog"
        aria-label="Welcome to Overlay"
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-6 left-4 right-4 rounded-xl border border-(--border) bg-(--surface-elevated) p-5 shadow-2xl"
      >
        <h3 className='mb-2 text-sm font-semibold text-(--foreground)'>
          Welcome to Overlay
        </h3>
        <ul className="mb-5 space-y-1.5 text-xs text-(--muted)">
          <li>
            💬 <strong className='text-(--foreground)'>Chat</strong> — talk
            to the best models, or multiple at once
          </li>
          <li>
            🎨 <strong className='text-(--foreground)'>Generate</strong> —
            images & video with best-in-class models
          </li>
          <li>
            🧠 <strong className='text-(--foreground)'>Knowledge</strong> —
            memories, files, connectors, skills & MCPs
          </li>
        </ul>
        <Button variant="ghost"
          type="button"
          onClick={onDismiss}
          className={unstyledButton("w-full rounded-md bg-(--foreground) py-2 text-xs font-medium text-(--background) transition-opacity hover:opacity-80")}
        >
          Get started
        </Button>
      </div>
    </div>
  )
}

/**
 * First-run onboarding is a sequence, not an armed overlay: an optional
 * name-your-workspace step, then the guided tour on the chat surface (where its
 * spotlight targets exist). The tour never sits invisible on a page that cannot
 * render it, so it cannot pop up mid-exploration.
 */
type OnboardingPhase = 'idle' | 'name' | 'tour'

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
  const { activeWorkspace, activeWorkspaceId, status: workspaceStatus } = useWorkspace()
  const [phase, setPhase] = useState<OnboardingPhase>('idle')
  const [isClosing, setIsClosing] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [isMobile, setIsMobile] = useState(false)
  const checkedRef = useRef(false)
  const prevUserIdRef = useRef<string | undefined>(undefined)
  // Whether this app load arrived via the post-signup redirect. Captured once so
  // a fast navigation during workspace loading cannot lose the trigger.
  const [enteredFromSignup] = useState(
    () => typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).get('onboarding') === '1',
  )

  const onInvitationRoute = Boolean(pathname?.startsWith('/app/invitations'))
  // 'error' never onboards: the workspace gate already owns that screen.
  const workspaceReady = workspaceStatus === 'ready' || workspaceStatus === 'idle'

  const chatHref = activeWorkspaceId
    ? buildWorkspaceHref(activeWorkspaceId, '/app/chat')
    : '/app/chat'

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

  /** onboarding=1 / tour=replay are one-shot triggers; drop them so a refresh cannot refire. */
  const stripOnboardingParams = useCallback(() => {
    const url = new URL(window.location.href)
    let changed = false
    for (const key of ['onboarding', 'tour']) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key)
        changed = true
      }
    }
    if (changed) router.replace(`${url.pathname}${url.search}${url.hash}`)
  }, [router])

  const beginTour = useCallback(() => {
    setCurrentStep(0)
    // Tour targets live on the chat surface; go there first. The tour chrome
    // itself only mounts once a chat surface is live (see showTourChrome), so
    // it can never sit invisible on a page that cannot render it. The mobile
    // welcome card is not anchored, so it needs no navigation.
    if (!isMobile && pathname && resolveWorkspaceSurface(pathname) !== 'chat') {
      router.push(chatHref)
    }
    setPhase('tour')
  }, [chatHref, isMobile, pathname, router])

  const workspaceNeedsName = Boolean(
    activeWorkspace
    && activeWorkspace.role === 'owner'
    && (peopleInWorkspace(activeWorkspace) ?? 1) <= 1
    && isStartingWorkspaceName(activeWorkspace.name),
  )

  const beginOnboarding = useCallback(() => {
    // Naming leads the flow only while the workspace still has its generated name.
    if (workspaceNeedsName) {
      setPhase('name')
      return
    }
    beginTour()
  }, [beginTour, workspaceNeedsName])

  // If the workspace is renamed or switched out from under the name step, keep the flow going.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (phase === 'name' && !workspaceNeedsName) beginTour()
  }, [phase, workspaceNeedsName, beginTour])

  // One-shot onboarding check; checkedRef prevents overlapping runs.
  // Onboarding only fires on an explicit trigger (the post-signup ?onboarding=1
  // redirect or a ?tour=replay): it never reads the server flag to start by
  // itself, so nothing can appear mid-session.
  useEffect(() => {
    if (isLoading || !isAuthenticated || !user?.id || !workspaceReady || checkedRef.current) return
    // Invitation accept must stay fully interactive; the tour's full-screen
    // click shield would block "Accept invitation" when targets are missing.
    if (onInvitationRoute) return
    checkedRef.current = true

    if (!enteredFromSignup) return

    if (hasCompletionHint(user.id)) {
      stripOnboardingParams()
      return
    }

    stripOnboardingParams()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    beginOnboarding()
  }, [
    isLoading,
    isAuthenticated,
    user?.id,
    workspaceReady,
    onInvitationRoute,
    enteredFromSignup,
    beginOnboarding,
    stripOnboardingParams,
  ])

  // Replay from settings: ?tour=replay can arrive at any time (no checkedRef guard)
  useEffect(() => {
    if (!isAuthenticated || onInvitationRoute) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('tour') !== 'replay') return
    stripOnboardingParams()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    beginTour()
  }, [isAuthenticated, onInvitationRoute, beginTour, stripOnboardingParams])

  const startTour = useCallback(() => {
    beginTour()
  }, [beginTour])

  const closeTour = useCallback(() => {
    setIsClosing(true)
    void markComplete(user?.id)
    setTimeout(() => {
      setPhase('idle')
      setIsClosing(false)
    }, 220)
  }, [user?.id])

  // Steps 0 and 1 require the chat surface (model picker + generation mode toggle).
  const navigateForStep = useCallback(
    (step: number) => {
      if ((step === 0 || step === 1) && pathname && resolveWorkspaceSurface(pathname) !== 'chat') {
        router.push(chatHref)
      }
    },
    [chatHref, pathname, router],
  )

  const handleNext = useCallback(() => {
    const next = currentStep + 1
    navigateForStep(next)
    setCurrentStep(next)
  }, [currentStep, navigateForStep])

  const handleBack = useCallback(() => {
    const prev = currentStep - 1
    navigateForStep(prev)
    setCurrentStep(prev)
  }, [currentStep, navigateForStep])

  const onboardingValue = useMemo(() => ({ startTour }), [startTour])

  // The tour only mounts where its spotlight targets exist. Mounting it in the
  // same tick as the navigation above would measure an empty target set and
  // leave it armed but invisible forever, so the chrome waits for a live chat
  // surface. If navigation never lands on chat, nothing renders rather than a
  // broken takeover.
  const onChatSurface = Boolean(pathname && resolveWorkspaceSurface(pathname) === 'chat')
  const showTourChrome = (phase === 'tour' || isClosing)
    && !onInvitationRoute
    && (isMobile || onChatSurface)

  return (
    <OnboardingContext.Provider value={onboardingValue}>
      {children}
      {phase === 'name' && !onInvitationRoute ? <NameWorkspaceStep onDone={beginTour} /> : null}
      {showTourChrome && isMobile && (
        <MobileWelcomeCard onDismiss={closeTour} />
      )}
      {showTourChrome && !isMobile && (
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
