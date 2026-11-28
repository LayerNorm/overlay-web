import { navigateToExternalFlow } from '@/components/chrome/chrome-extension'

export function navigateToOnboardingCheckout(url: string) {
  const suppressWarning = (event: BeforeUnloadEvent) => event.stopImmediatePropagation()
  window.addEventListener('beforeunload', suppressWarning, { capture: true, once: true })
  try {
    navigateToExternalFlow(url)
  } catch (error) {
    window.removeEventListener('beforeunload', suppressWarning, true)
    throw error
  }
}
