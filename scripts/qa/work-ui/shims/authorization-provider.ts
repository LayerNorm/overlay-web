const denied = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('workDenied') === '1'
export function useAuthorization() {
  return { allows: () => !denied, can: () => !denied }
}
