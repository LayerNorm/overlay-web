import { app, BrowserWindow } from 'electron'

// On macOS, setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
// transforms the process into a UIElement (accessory) app so the window can
// float over fullscreen Spaces. That transform removes the app from the Dock,
// Cmd+Tab, and the Force Quit dialog. Re-assert the regular activation policy
// shortly after the transform so the app stays a normal foreground app.
// The window keeps its all-spaces/fullscreen-auxiliary collection behavior.
type AlwaysOnTopLevel = NonNullable<Parameters<BrowserWindow['setAlwaysOnTop']>[1]>

export function setVisibleOnAllWorkspacesKeepDock(
  win: BrowserWindow,
  alwaysOnTopLevel: AlwaysOnTopLevel = 'floating',
  options: { skipTransformProcessType?: boolean } = {}
): void {
  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    // Prefer skipping the UIElement↔Foreground transform: that flip hides the
    // Dock briefly and on multi-monitor Macs can yank the user to another Space.
    skipTransformProcessType: options.skipTransformProcessType ?? true
  })
  // Only run the Dock re-assert when we actually transformed process type.
  if (options.skipTransformProcessType === false) {
    restoreDockIcon(win, alwaysOnTopLevel)
  } else if (win && !win.isDestroyed() && win.isVisible()) {
    win.setAlwaysOnTop(true, alwaysOnTopLevel)
  }
}

export function restoreDockIcon(
  win?: BrowserWindow,
  alwaysOnTopLevel: AlwaysOnTopLevel = 'floating'
): void {
  if (process.platform !== 'darwin') return
  // Delay so the show() lands after Electron's internal process-type transform
  setTimeout(() => {
    app.setActivationPolicy('regular')
    void app.dock?.show()
    // Never moveTop/raise hidden windows — on macOS that can surface preloaded
    // chat/notebook panels that were intentionally created with show: false.
    if (win && !win.isDestroyed() && win.isVisible()) {
      win.setAlwaysOnTop(true, alwaysOnTopLevel)
      win.moveTop()
    }
  }, 300)
}
