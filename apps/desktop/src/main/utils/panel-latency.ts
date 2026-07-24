import { is } from '@electron-toolkit/utils'

export type PanelLatencyPanel = 'chat' | 'notebook' | 'browser'

interface PanelLatencySession {
  panel: PanelLatencyPanel
  hotkeyAt?: number
  toggleAt?: number
  showAt?: number
  detectEditingAt?: number
  paintAt?: number
  hydrateAt?: number
}

const sessions = new Map<PanelLatencyPanel, PanelLatencySession>()

export function isPanelLatencyEnabled(): boolean {
  return is.dev || process.env.PANEL_LATENCY === '1'
}

function getSession(panel: PanelLatencyPanel): PanelLatencySession {
  const existing = sessions.get(panel)
  if (existing) return existing
  const session: PanelLatencySession = { panel }
  sessions.set(panel, session)
  return session
}

function delta(from?: number, to?: number): number | null {
  if (from === undefined || to === undefined) return null
  return Math.round(to - from)
}

function logSummary(session: PanelLatencySession): void {
  if (!isPanelLatencyEnabled()) return
  const hotkeyToShow = delta(session.hotkeyAt, session.showAt)
  const showToPaint = delta(session.showAt, session.paintAt)
  const paintToHydrate = delta(session.paintAt, session.hydrateAt)
  const hotkeyToPaint = delta(session.hotkeyAt, session.paintAt)
  const detectEditingMs = delta(session.toggleAt, session.detectEditingAt)

  console.log(
    `[PanelLatency] ${session.panel}` +
      (hotkeyToShow !== null ? ` hotkey→show=${hotkeyToShow}ms` : '') +
      (showToPaint !== null ? ` show→paint=${showToPaint}ms` : '') +
      (paintToHydrate !== null ? ` paint→hydrate=${paintToHydrate}ms` : '') +
      (hotkeyToPaint !== null ? ` hotkey→paint=${hotkeyToPaint}ms` : '') +
      (detectEditingMs !== null ? ` detectEditing=${detectEditingMs}ms` : '')
  )
}

export function panelLatencyMarkHotkey(panel: PanelLatencyPanel): void {
  if (!isPanelLatencyEnabled()) return
  sessions.set(panel, { panel, hotkeyAt: Date.now() })
}

export function panelLatencyMarkToggleStart(panel: PanelLatencyPanel): void {
  if (!isPanelLatencyEnabled()) return
  const session = getSession(panel)
  session.toggleAt = Date.now()
}

export function panelLatencyMarkShow(panel: PanelLatencyPanel): void {
  if (!isPanelLatencyEnabled()) return
  const session = getSession(panel)
  session.showAt = Date.now()
}

export function panelLatencyMarkDetectEditingDone(panel: PanelLatencyPanel): void {
  if (!isPanelLatencyEnabled()) return
  const session = getSession(panel)
  session.detectEditingAt = Date.now()
}

export function panelLatencyMarkPaint(panel: PanelLatencyPanel): void {
  if (!isPanelLatencyEnabled()) return
  const session = getSession(panel)
  session.paintAt = Date.now()
}

export function panelLatencyMarkHydrate(panel: PanelLatencyPanel): void {
  if (!isPanelLatencyEnabled()) return
  const session = getSession(panel)
  session.hydrateAt = Date.now()
  logSummary(session)
  sessions.delete(panel)
}
