import { useState, useCallback, useEffect } from 'react'
import { OnboardingStep } from '../components/onboarding/types'
import { loadVerifiedAuthSession } from '../services/auth-service'

interface UseOnboardingOptions {
  startAtAuth?: boolean
  onComplete: () => void
}

interface UseOnboardingReturn {
  step: OnboardingStep
  isTransitioning: boolean
  transitionTo: (nextStep: OnboardingStep) => void
}

export function useOnboarding({
  startAtAuth = false,
  onComplete
}: UseOnboardingOptions): UseOnboardingReturn {
  const [step, setStep] = useState<OnboardingStep>(startAtAuth ? 'auth' : 'welcome')
  const [isTransitioning, setIsTransitioning] = useState(false)

  // Full onboarding and auth-only onboarding intentionally share the same
  // component. Reset the internal step when the mode changes so React cannot
  // preserve a stale final onboarding step while switching to re-authentication.
  useEffect(() => {
    setStep(startAtAuth ? 'auth' : 'welcome')
    setIsTransitioning(false)
  }, [startAtAuth])

  // Check if already signed in AND onboarding was previously completed
  useEffect(() => {
    const checkOnboardingStatus = async (): Promise<void> => {
      const session = await loadVerifiedAuthSession()
      const onboardingComplete = await window.bridge?.checkOnboardingComplete?.()
      if (session && onboardingComplete) {
        onComplete()
      }
    }
    checkOnboardingStatus()
  }, [onComplete])

  const transitionTo = useCallback(
    (nextStep: OnboardingStep): void => {
      setIsTransitioning(true)
      setTimeout(() => {
        setStep(nextStep)
        setIsTransitioning(false)
      }, 300)
    },
    []
  )

  return {
    step,
    isTransitioning,
    transitionTo
  }
}
