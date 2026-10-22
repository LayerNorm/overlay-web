export const TOUR_NAVIGATION_EVENT = 'overlay:tour-navigation'

export function setTourNavigationOpen(open: boolean) {
  window.dispatchEvent(new CustomEvent(TOUR_NAVIGATION_EVENT, { detail: { open } }))
}

export function getMobileTourHost() {
  return window.matchMedia('(max-width: 767px)').matches
    ? document.querySelector<HTMLElement>('[data-mobile-tour-host]')
    : null
}

export function subscribeToMobileTourHost(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.body, { childList: true, subtree: true })
  window.addEventListener('resize', onChange)
  return () => { observer.disconnect(); window.removeEventListener('resize', onChange) }
}
