export function navigateToOnboardingCheckout(url: string) {
  const suppressWarning = (event: BeforeUnloadEvent) => event.stopImmediatePropagation()
  window.addEventListener('beforeunload', suppressWarning, { capture: true, once: true })
  try {
    window.location.assign(url)
  } catch (error) {
    window.removeEventListener('beforeunload', suppressWarning, true)
    throw error
  }
}
