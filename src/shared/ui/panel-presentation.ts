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
