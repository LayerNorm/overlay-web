import { app, BrowserWindow } from 'electron'

let yieldingFocusUntil = 0

/** True briefly while we hide→restore to hand focus back to the prior app. */
export function isYieldingFocus(): boolean {
  return Date.now() < yieldingFocusUntil
}

/**
 * A visible MainWindow owns the normal application lifecycle. Hiding the last
 * floating panel must not call app.hide(), because macOS would hide MainWindow
 * too and later restore it as a side effect of showing another panel.
 */
export function yieldFocusAfterLastPanelHidden(
  mainWindow: BrowserWindow | undefined,
  restoreWindows: BrowserWindow[]
): void {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    return
  }
  yieldFocusToPreviousApp(restoreWindows)
}

/**
 * Hand keyboard focus back to the previously active app (macOS).
 * Hides the Overlay app (which restores the prior frontmost app), then
 * re-shows only the windows that should stay visible — without focusing them —
 * so the pill can remain on screen while Chrome/etc. receive Cmd+W.
 */
export function yieldFocusToPreviousApp(restoreWindows: BrowserWindow[]): void {
  const visibleRestores = restoreWindows.filter((win) => win && !win.isDestroyed() && win.isVisible())
  const restoreSet = new Set(visibleRestores)
  const windowsToKeepHidden = BrowserWindow.getAllWindows().filter(
    (win) => !win.isDestroyed() && !restoreSet.has(win)
  )

  if (process.platform !== 'darwin') {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && win.isFocused()) {
        win.blur()
      }
    }
    return
  }

  yieldingFocusUntil = Date.now() + 400
  try {
    app.hide()
  } catch (error) {
    console.error('[Focus] Failed to yield focus to previous app:', error)
    return
  }

  // macOS applies app.hide() at the application level. Re-showing individual
  // windows in the same call stack races that hide and can leave the persistent
  // Overlay pill (and an already-open MainWindow) hidden with the last panel.
  // Wait for the hide to settle, then restore the exact pre-hide visibility
  // snapshot without activating Overlay or reopening any panel windows.
  setImmediate(() => {
    try {
      // show() reverses the application-level hidden state without focusing the
      // app. Re-hide every window outside the explicit restore set before the
      // compositor can expose a preloaded or previously hidden panel.
      app.show()
      for (const win of windowsToKeepHidden) {
        if (!win.isDestroyed() && win.isVisible()) {
          win.hide()
        }
      }
      for (const win of visibleRestores) {
        if (!win.isDestroyed()) {
          win.showInactive()
        }
      }
    } catch (error) {
      console.error('[Focus] Failed to restore persistent windows after yielding focus:', error)
    }
  })
}
