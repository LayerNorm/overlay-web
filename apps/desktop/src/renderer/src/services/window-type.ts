/**
 * Which Electron window this renderer is running in (`?window=main|chat|
 * notebook|browser|…`). Panel windows mount the same provider tree as the
 * main window, so workspace-change fan-out must be gated on this: only the
 * main window eagerly loads workspace-scoped lists. Panels stay correctly
 * scoped without refetching because the app API client reads the persisted
 * workspace id lazily per request.
 */

export function getWindowType(): string {
  try {
    return new URLSearchParams(window.location.search).get('window') || 'overlay'
  } catch {
    return 'overlay'
  }
}

export function isMainAppWindow(): boolean {
  return getWindowType() === 'main'
}
