export type PanelLatencyPanel = 'chat' | 'notebook' | 'browser'

/** Fire renderer-ready + paint latency after the shell has committed. */
export function signalPanelShellReady(panelType: PanelLatencyPanel): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void window.bridge?.notifyPanelRendererReady?.(panelType)
      void window.bridge?.reportPanelLatency?.({ panelType, stage: 'paint' })
    })
  })
}

/** Run work after first paint (double rAF). */
export function afterPanelFirstPaint(run: () => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(run)
  })
}

export function markPanelHydrateComplete(panelType: PanelLatencyPanel): void {
  void window.bridge?.reportPanelLatency?.({ panelType, stage: 'hydrate' })
}

/** Focus once after paint when panel becomes visible. */
export function focusAfterPanelPaint(focus: () => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      focus()
    })
  })
}
