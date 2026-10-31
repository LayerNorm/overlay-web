'use client'

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'overlay:app-sidebar-collapsed'
const SIDEBAR_COLLAPSED_EVENT = 'overlay:sidebar-collapsed-change'
let fallbackCollapsed = false

export function getSidebarCollapsedSnapshot(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    return fallbackCollapsed
  }
}

export function subscribeToSidebarCollapsed(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const onStorage = (event: StorageEvent) => {
    if (event.key === SIDEBAR_COLLAPSED_STORAGE_KEY) onStoreChange()
  }
  const onLocalChange = () => onStoreChange()

  window.addEventListener('storage', onStorage)
  window.addEventListener(SIDEBAR_COLLAPSED_EVENT, onLocalChange)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(SIDEBAR_COLLAPSED_EVENT, onLocalChange)
  }
}

export function setStoredSidebarCollapsed(next: boolean) {
  if (typeof window === 'undefined') return
  fallbackCollapsed = next
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, next ? 'true' : 'false')
  } catch {
    // Private browsers can deny storage; the toggle still works for this page.
  }
  window.dispatchEvent(new Event(SIDEBAR_COLLAPSED_EVENT))
}
