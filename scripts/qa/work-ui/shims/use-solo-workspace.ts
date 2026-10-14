export function useIsSoloWorkspace(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('solo') === '1'
}
