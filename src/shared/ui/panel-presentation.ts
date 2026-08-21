/**
 * How auxiliary right-hand panels present themselves — the chat sources panel and
 * the note assistant. One preference so the two surfaces agree: flipping it in
 * either header moves both.
 *
 * `floating` lays the panel over the page and fades it in and out.
 * `sidebar` docks it as a real column that slides and takes width.
 */
export type PanelPresentation = 'floating' | 'sidebar'

export const PANEL_PRESENTATION_KEY = 'overlay_panel_presentation'

export function readStoredPanelPresentation(): PanelPresentation {
  if (typeof window === 'undefined') return 'floating'
  try {
    return window.localStorage.getItem(PANEL_PRESENTATION_KEY) === 'sidebar' ? 'sidebar' : 'floating'
  } catch {
    return 'floating'
  }
}

export function storePanelPresentation(presentation: PanelPresentation): void {
  try {
    window.localStorage.setItem(PANEL_PRESENTATION_KEY, presentation)
  } catch {
    // Ignore blocked storage; the current session still reflects the preference.
  }
}

/** AppScreen speaks docked/floating; the stored preference speaks sidebar/floating. */
export function toRightPanelMode(presentation: PanelPresentation): 'docked' | 'floating' {
  return presentation === 'sidebar' ? 'docked' : 'floating'
}

export const PANEL_WIDTH_KEY = 'overlay_panel_width'
/** Narrow enough to still read, wide enough for a framed page. */
export const MIN_PANEL_WIDTH = 320
export const MAX_PANEL_WIDTH = 880

export function clampPanelWidth(width: number): number {
  const ceiling = typeof window === 'undefined'
    ? MAX_PANEL_WIDTH
    : Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.round(window.innerWidth * 0.7)))
  return Math.round(Math.min(ceiling, Math.max(MIN_PANEL_WIDTH, width)))
}

/** Null until the user drags, so each panel keeps its own default width. */
export function readStoredPanelWidth(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(PANEL_WIDTH_KEY)
    if (!raw) return null
    const value = Number.parseInt(raw, 10)
    return Number.isFinite(value) ? clampPanelWidth(value) : null
  } catch {
    return null
  }
}

export function storePanelWidth(width: number): void {
  try {
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(width))
  } catch {
    // Ignore blocked storage; the current session still reflects the width.
  }
}
