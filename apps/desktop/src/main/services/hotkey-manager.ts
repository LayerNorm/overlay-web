import { globalShortcut, systemPreferences } from 'electron'
import { settingsService } from './settings-service'
import { panelLatencyMarkHotkey } from '../utils/panel-latency'

// Lazily loaded uiohook module to prevent accessibility prompt at startup
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let uIOhookInstance: any = null

/**
 * Check if accessibility permissions are granted on macOS
 * This MUST be called before loading uiohook-napi to prevent crashes
 */
function hasAccessibilityPermission(): boolean {
  if (process.platform === 'darwin') {
    return systemPreferences.isTrustedAccessibilityClient(false)
  }
  return true
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getUIOhook(): Promise<any | null> {
  // CRITICAL: Check accessibility permission BEFORE importing uiohook-napi
  // The native module will crash if it tries to initialize without permissions
  if (!hasAccessibilityPermission()) {
    console.log('[HotkeyManager] Cannot load uiohook - accessibility permission not granted')
    return null
  }

  if (!uIOhookInstance) {
    const module = await import('uiohook-napi')
    uIOhookInstance = module.uIOhook
  }
  return uIOhookInstance
}

/**
 * Centralized hotkey manager using Electron's globalShortcut API for toggle modes
 * and uIOhook for push-to-talk (which requires keyup detection)
 *
 * This is a cleaner, more maintainable implementation that centralizes all hotkey logic
 */

export type HotkeyMode =
  | 'push-to-talk'
  | 'transcription'
  | 'assistant'
  | 'panel-chat'
  | 'panel-notebook'
export type PanelToggleMode = 'chat' | 'notebook' | 'browser'

interface HotkeyCallbacks {
  onRecordingStart: (mode: HotkeyMode) => void
  onRecordingStop: (mode: HotkeyMode) => void
  onRecordingCancel: (mode: HotkeyMode) => void
}

interface PanelToggleCallbacks {
  onPanelToggle: (panel: PanelToggleMode) => void
}

// Extended callbacks for panel hold-to-transcribe
interface PanelTranscribeCallbacks {
  onPanelRecordingStart: (panel: PanelToggleMode, wasVisible: boolean) => void
  onPanelRecordingStop: (panel: PanelToggleMode, wasVisible: boolean) => void
  onPanelQuickToggle: (panel: PanelToggleMode) => void
  isPanelVisible: (panel: PanelToggleMode) => boolean
  showPanel: (panel: PanelToggleMode) => void
  hidePanel: (panel: PanelToggleMode) => void
}

class HotkeyManager {
  private registeredHotkeys: Map<HotkeyMode, string> = new Map()
  private registeredPanelHotkeys: Map<PanelToggleMode, string> = new Map()
  private configuredHotkeys: Map<HotkeyMode, string> = new Map()
  private configuredPanelHotkeys: Map<PanelToggleMode, string> = new Map()
  private activeToggles: Set<HotkeyMode> = new Set()
  private callbacks: HotkeyCallbacks | null = null
  private panelCallbacks: PanelToggleCallbacks | null = null
  private panelTranscribeCallbacks: PanelTranscribeCallbacks | null = null
  private isRecording = false
  private currentMode: HotkeyMode | null = null
  private recordingStartTime: number | null = null

  // Push-to-talk specific state (requires uIOhook for keyup detection)
  private pushToTalkKeyGroups: number[][] = []
  private pressedKeys: Set<number> = new Set()
  private uiohookStarted = false
  private uiohookStartPromise: Promise<boolean> | null = null
  private uiohookGeneration = 0

  // Panel hold-to-transcribe state
  private panelKeyGroups: Map<PanelToggleMode, number[][]> = new Map()
  private activePanelRecording: PanelToggleMode | null = null
  private panelRecordingStartTime: number | null = null
  private panelWasVisibleBeforeRecording: boolean = false

  // Panel hold detection state
  private pendingPanelHotkey: PanelToggleMode | null = null
  /** True if the panel was already visible when the pending press began. */
  private pendingPanelWasVisible = false
  /** True if we already showed the panel on keydown (hidden→show optimistic path). */
  private pendingPanelOpenedOnKeydown = false
  private panelHoldTimeout: NodeJS.Timeout | null = null
  /** When each panel was last shown via hotkey (for rapid re-press → instant hide). */
  private lastPanelShownAt = new Map<PanelToggleMode, number>()
  /** Re-press within this window always hides (skip hold-vs-tap ambiguity). */
  private readonly RAPID_REPRESS_HIDE_MS = 450

  // Combined hotkey mode (transcription + push-to-talk share same accelerator)
  private combinedHotkeyAccelerator: string | null = null
  private combinedKeyGroups: number[][] = []
  private pendingCombinedPress = false
  private combinedHoldTimeout: NodeJS.Timeout | null = null
  private combinedDebounceUntil = 0
  private readonly COMBINED_HOLD_THRESHOLD_MS = 500
  private readonly COMBINED_DEBOUNCE_MS = 350

  // Minimum recording duration to prevent accidental quick releases (in milliseconds)
  private readonly MIN_RECORDING_DURATION_MS = 200
  // Hold threshold - time to wait before considering it a "hold" (in milliseconds)
  private readonly HOLD_THRESHOLD_MS = 200

  /**
   * Convert display format hotkey to Electron accelerator format
   * Example: "Option ⌥ + Shift ⇧ + Z" -> "Alt+Shift+Z"
   */
  private convertToAccelerator(displayHotkey: string): string {
    const keyMap: Record<string, string> = {
      'Cmd ⌘': 'Command',
      'Ctrl ⌃': 'Control',
      'Option ⌥': 'Alt',
      'Shift ⇧': 'Shift',
      'Space ␣': 'Space',
      'Return ↵': 'Return',
      'Esc ⎋': 'Escape',
      'Tab ⇥': 'Tab',
      'Delete ⌫': 'Backspace',
      '↑': 'Up',
      '↓': 'Down',
      '←': 'Left',
      '→': 'Right'
    }

    const parts = displayHotkey.split(' + ').map((part) => part.trim())
    const acceleratorParts = parts.map((part) => {
      if (keyMap[part]) {
        return keyMap[part]
      }
      return part.toUpperCase()
    })

    return acceleratorParts.join('+')
  }

  /**
   * Convert display format hotkey to uIOhook keycodes (for push-to-talk)
   */
  private convertToKeycodes(displayHotkey: string): number[][] {
    const KEY_TO_KEYCODE: Record<string, number[]> = {
      'Cmd ⌘': [3675, 3676],
      'Ctrl ⌃': [29, 3613],
      'Option ⌥': [56, 3640],
      'Shift ⇧': [42, 54],
      '0': [11],
      '1': [2],
      '2': [3],
      '3': [4],
      '4': [5],
      '5': [6],
      '6': [7],
      '7': [8],
      '8': [9],
      '9': [10],
      '-': [12],
      '=': [13],
      '[': [26],
      ']': [27],
      '\\': [43],
      ';': [39],
      "'": [40],
      ',': [51],
      '.': [52],
      '/': [53],
      '`': [41],
      'Space ␣': [57],
      'Return ↵': [28],
      'Esc ⎋': [1],
      'Tab ⇥': [15],
      'Delete ⌫': [14],
      '↑': [200],
      '↓': [208],
      '←': [203],
      '→': [205],
      A: [30],
      B: [48],
      C: [46],
      D: [32],
      E: [18],
      F: [33],
      G: [34],
      H: [35],
      I: [23],
      J: [36],
      K: [37],
      L: [38],
      M: [50],
      N: [49],
      O: [24],
      P: [25],
      Q: [16],
      R: [19],
      S: [31],
      T: [20],
      U: [22],
      V: [47],
      W: [17],
      X: [45],
      Y: [21],
      Z: [44]
    }

    const parts = displayHotkey.split(' + ').map((part) => part.trim())
    const keyGroups: number[][] = []

    for (const part of parts) {
      if (KEY_TO_KEYCODE[part]) {
        keyGroups.push(KEY_TO_KEYCODE[part])
      }
    }

    return keyGroups.length > 0 ? keyGroups : [[56, 3640]] // Default to Option
  }

  /**
   * Check if all keys in the key groups are pressed
   */
  private areAllKeysPressed(keyGroups: number[][]): boolean {
    if (keyGroups.length === 0) return false
    return keyGroups.every((group) => group.some((keycode) => this.pressedKeys.has(keycode)))
  }

  /**
   * Check if the hotkey manager has been initialized
   */
  isInitialized(): boolean {
    return this.callbacks !== null
  }

  /**
   * Initialize the hotkey manager with callbacks
   */
  initialize(callbacks: HotkeyCallbacks): void {
    this.callbacks = callbacks
  }

  /**
   * Initialize panel toggle callbacks
   */
  initializePanelCallbacks(callbacks: PanelToggleCallbacks): void {
    this.panelCallbacks = callbacks
  }

  /**
   * Initialize panel transcribe callbacks for hold-to-transcribe feature
   */
  initializePanelTranscribeCallbacks(callbacks: PanelTranscribeCallbacks): void {
    this.panelTranscribeCallbacks = callbacks
  }

  /**
   * Register a hotkey for a panel toggle with hold-to-transcribe support
   * For chat and notebook panels: hold to record, quick press to toggle
   * For browser panel: simple toggle only
   */
  registerPanelHotkey(panel: PanelToggleMode, displayHotkey: string): boolean {
    if (!displayHotkey) {
      this.configuredPanelHotkeys.delete(panel)
      this.unregisterPanelHotkey(panel)
      return true
    }

    this.configuredPanelHotkeys.set(panel, displayHotkey)

    try {
      console.log(`[HotkeyManager] Registering panel hotkey ${panel}: ${displayHotkey}`)
      this.unregisterPanelHotkey(panel, false)
      const accelerator = this.convertToAccelerator(displayHotkey)

      // For chat and notebook panels, use hybrid approach (like push-to-talk)
      if (panel === 'chat' || panel === 'notebook') {
        // Convert to keycodes for release detection
        const keyGroups = this.convertToKeycodes(displayHotkey)
        this.panelKeyGroups.set(panel, keyGroups)

        // Check accessibility permission BEFORE registering the hotkey
        // This prevents the native module from being loaded without permissions
        if (!hasAccessibilityPermission()) {
          console.log(
            `[HotkeyManager] Cannot register ${panel} panel hotkey - accessibility permission not granted`
          )
          return false
        }

        const success = globalShortcut.register(accelerator, () => {
          // Check auth state before triggering
          if (!settingsService.isAuthenticated) {
            console.log(`[HotkeyManager] Panel hotkey blocked - not authenticated`)
            return
          }
          this.startPanelHotkeyPress(panel)
        })

        if (success) {
          this.registeredPanelHotkeys.set(panel, accelerator)
          // Start uIOhook for key release monitoring (will check permissions internally)
          this.startUIOhook().then((started) => {
            if (!started) {
              console.warn(
                `[HotkeyManager] uIOhook not started for ${panel} - hold-to-transcribe will be disabled`
              )
            }
          })
          console.log(
            `[HotkeyManager] Panel hotkey registered (hybrid): ${panel} -> ${accelerator}, keycodes:`,
            keyGroups
          )
        } else {
          console.error(`[HotkeyManager] Failed to register ${panel} panel hotkey: ${accelerator}`)
        }

        return success
      } else {
        // Browser panel: simple toggle only
        const success = globalShortcut.register(accelerator, () => {
          if (!settingsService.isAuthenticated) {
            console.log(`[HotkeyManager] Panel toggle blocked - not authenticated`)
            return
          }
          console.log(`[HotkeyManager] Panel toggle triggered: ${panel}`)
          panelLatencyMarkHotkey(panel)
          this.panelCallbacks?.onPanelToggle(panel)
        })

        if (success) {
          this.registeredPanelHotkeys.set(panel, accelerator)
          console.log(
            `[HotkeyManager] Successfully registered ${panel} panel hotkey: ${accelerator}`
          )
        } else {
          console.error(`[HotkeyManager] Failed to register ${panel} panel hotkey: ${accelerator}`)
        }

        return success
      }
    } catch (error) {
      console.error(`[HotkeyManager] Error registering ${panel} panel hotkey:`, error)
      return false
    }
  }

  /**
   * Start panel hotkey press - begins hold detection
   * Hidden panel: show immediately on keydown; release = stay open, hold = record
   * Visible panel: release = hide, hold = record (stay open)
   */
  private startPanelHotkeyPress(panel: PanelToggleMode): void {
    // Don't start if already recording with any mode
    if (this.isRecording || this.activePanelRecording) {
      console.log('[HotkeyManager] Already recording, ignoring panel hotkey')
      return
    }

    // A new press while one is pending: either key-repeat (ignore) or a missed
    // keyup between two rapid taps (finalize previous tap, then continue).
    if (this.pendingPanelHotkey) {
      const keyGroups = this.panelKeyGroups.get(this.pendingPanelHotkey)
      const stillHeld = keyGroups ? this.areAllKeysPressed(keyGroups) : false
      if (stillHeld) {
        console.log('[HotkeyManager] Panel hotkey repeat while held, ignoring')
        return
      }
      console.log('[HotkeyManager] Finalizing previous panel tap before new press')
      this.handlePanelTap(this.pendingPanelHotkey)
    }

    const wasVisible = this.panelTranscribeCallbacks?.isPanelVisible(panel) ?? false
    console.log(
      `[HotkeyManager] Panel hotkey pressed: ${panel}, wasVisible=${wasVisible}, starting hold detection`
    )

    // Rapid second press while open → hide immediately (double-tap dismiss).
    // Skip hold detection so hide doesn't wait for keyup / 200ms threshold.
    if (wasVisible) {
      const lastShown = this.lastPanelShownAt.get(panel) ?? 0
      if (Date.now() - lastShown < this.RAPID_REPRESS_HIDE_MS) {
        console.log(`[HotkeyManager] Rapid re-press on ${panel}, hiding immediately`)
        panelLatencyMarkHotkey(panel)
        this.panelTranscribeCallbacks?.hidePanel(panel)
        this.lastPanelShownAt.delete(panel)
        return
      }
    }

    this.pendingPanelHotkey = panel
    this.pendingPanelWasVisible = wasVisible
    this.pendingPanelOpenedOnKeydown = false

    // Show immediately when opening — don't wait for keyup / hold threshold.
    if (!wasVisible) {
      panelLatencyMarkHotkey(panel)
      this.panelTranscribeCallbacks?.showPanel(panel)
      this.pendingPanelOpenedOnKeydown = true
      this.lastPanelShownAt.set(panel, Date.now())
    }

    this.panelHoldTimeout = setTimeout(() => {
      if (this.pendingPanelHotkey === panel) {
        console.log(`[HotkeyManager] Hold threshold reached for ${panel}, starting recording`)
        this.startPanelRecordingAfterHold(panel)
      }
    }, this.HOLD_THRESHOLD_MS)

    this.monitorPanelKeyReleaseForTap(panel)
  }

  /**
   * Start recording after hold threshold is reached
   */
  private startPanelRecordingAfterHold(panel: PanelToggleMode): void {
    const wasVisibleBeforePress = this.pendingPanelWasVisible
    const openedOnKeydown = this.pendingPanelOpenedOnKeydown
    // Clear pending state
    this.pendingPanelHotkey = null
    this.pendingPanelWasVisible = false
    this.pendingPanelOpenedOnKeydown = false
    if (this.panelHoldTimeout) {
      clearTimeout(this.panelHoldTimeout)
      this.panelHoldTimeout = null
    }

    // Now start actual recording
    this.activePanelRecording = panel
    this.panelRecordingStartTime = Date.now()
    this.isRecording = true
    this.currentMode = panel === 'chat' ? 'panel-chat' : 'panel-notebook'
    this.recordingStartTime = Date.now()

    // Notify that panel recording has started
    // The callback will check panel visibility and open if needed
    this.panelWasVisibleBeforeRecording = wasVisibleBeforePress || openedOnKeydown
    this.panelTranscribeCallbacks?.onPanelRecordingStart(panel, this.panelWasVisibleBeforeRecording)
    this.callbacks?.onRecordingStart(this.currentMode)

    // Continue monitoring for key release to stop recording
    this.monitorPanelKeyRelease(panel)
  }

  /**
   * Handle early key release (tap) before hold threshold
   */
  private handlePanelTap(panel: PanelToggleMode): void {
    const wasVisible = this.pendingPanelWasVisible
    const openedOnKeydown = this.pendingPanelOpenedOnKeydown
    console.log(
      `[HotkeyManager] Tap detected for ${panel}, wasVisible=${wasVisible}, openedOnKeydown=${openedOnKeydown}`
    )

    // Clear pending state
    this.pendingPanelHotkey = null
    this.pendingPanelWasVisible = false
    this.pendingPanelOpenedOnKeydown = false
    if (this.panelHoldTimeout) {
      clearTimeout(this.panelHoldTimeout)
      this.panelHoldTimeout = null
    }

    if (wasVisible) {
      // Tap while open → hide
      panelLatencyMarkHotkey(panel)
      this.panelTranscribeCallbacks?.hidePanel(panel)
      this.lastPanelShownAt.delete(panel)
    } else if (!openedOnKeydown) {
      // Fallback: show if we somehow didn't open on keydown
      panelLatencyMarkHotkey(panel)
      this.panelTranscribeCallbacks?.onPanelQuickToggle(panel)
      this.lastPanelShownAt.set(panel, Date.now())
    }
    // else: already shown on keydown — nothing to do
  }

  /**
   * Monitor for early key release during hold detection (tap detection)
   */
  private monitorPanelKeyReleaseForTap(panel: PanelToggleMode): void {
    const keyGroups = this.panelKeyGroups.get(panel)
    if (!keyGroups) return

    const checkInterval = setInterval(() => {
      // If we're no longer pending (either became a hold or was cancelled), stop monitoring
      if (this.pendingPanelHotkey !== panel) {
        clearInterval(checkInterval)
        return
      }

      // Check if keys are released before hold threshold
      if (!this.areAllKeysPressed(keyGroups)) {
        clearInterval(checkInterval)
        this.handlePanelTap(panel)
      }
    }, 10) // Check every 10ms for responsive tap detection
  }

  /**
   * Stop panel hotkey recording - called when key is released after recording has started
   */
  private stopPanelHotkeyRecording(): void {
    if (!this.activePanelRecording) {
      return
    }

    const panel = this.activePanelRecording
    const duration = this.panelRecordingStartTime ? Date.now() - this.panelRecordingStartTime : 0
    const wasVisible = this.panelWasVisibleBeforeRecording

    // Reset panel recording state
    const currentMode = this.currentMode
    this.activePanelRecording = null
    this.panelRecordingStartTime = null
    this.isRecording = false
    this.currentMode = null
    this.recordingStartTime = null

    console.log(`[HotkeyManager] Panel hold release (${duration}ms), transcribing for ${panel}`)
    this.callbacks?.onRecordingStop(currentMode!)
    this.panelTranscribeCallbacks?.onPanelRecordingStop(panel, wasVisible)
  }

  /**
   * Monitor key state to detect when panel hotkey keys are released
   */
  private monitorPanelKeyRelease(panel: PanelToggleMode): void {
    const keyGroups = this.panelKeyGroups.get(panel)
    if (!keyGroups) return

    const checkInterval = setInterval(() => {
      // If recording stopped by other means, clear interval
      if (!this.activePanelRecording || this.activePanelRecording !== panel) {
        clearInterval(checkInterval)
        return
      }

      // Check if all panel hotkey keys are still pressed
      if (!this.areAllKeysPressed(keyGroups)) {
        // Keys released, stop recording
        clearInterval(checkInterval)
        this.stopPanelHotkeyRecording()
      }
    }, 50) // Check every 50ms for responsive key release detection
  }

  /**
   * Set the panel visibility state before recording started
   * Called by the main process after checking panel visibility
   */
  setPanelWasVisible(wasVisible: boolean): void {
    this.panelWasVisibleBeforeRecording = wasVisible
  }

  /**
   * Unregister a panel hotkey
   */
  unregisterPanelHotkey(panel: PanelToggleMode, removeConfiguration = true): void {
    if (removeConfiguration) this.configuredPanelHotkeys.delete(panel)
    const accelerator = this.registeredPanelHotkeys.get(panel)
    if (accelerator) {
      globalShortcut.unregister(accelerator)
      this.registeredPanelHotkeys.delete(panel)
      console.log(`[HotkeyManager] Unregistered ${panel} panel hotkey`)
    }
    this.panelKeyGroups.delete(panel)
  }

  /**
   * Start uIOhook for monitoring key releases during push-to-talk
   *
   * This is used in hybrid mode where globalShortcut starts recording
   * and uIOhook monitors for key release to stop recording.
   *
   * IMPORTANT: This will only start if accessibility permissions are granted.
   * The native module will crash if loaded without permissions.
   */
  private startUIOhook(): Promise<boolean> {
    if (this.uiohookStarted) return Promise.resolve(true)
    if (this.uiohookStartPromise) return this.uiohookStartPromise

    const startPromise = this.initializeUIOhook(this.uiohookGeneration)
    this.uiohookStartPromise = startPromise
    void startPromise.then(
      () => {
        if (this.uiohookStartPromise === startPromise) this.uiohookStartPromise = null
      },
      () => {
        if (this.uiohookStartPromise === startPromise) this.uiohookStartPromise = null
      }
    )
    return startPromise
  }

  private async initializeUIOhook(generation: number): Promise<boolean> {
    // Check accessibility permission BEFORE trying to load the module
    if (!hasAccessibilityPermission()) {
      console.log('[HotkeyManager] Cannot start uIOhook - accessibility permission not granted')
      return false
    }

    const hook = await getUIOhook()

    // If hook is null, accessibility permission was denied or revoked
    if (!hook) {
      console.log('[HotkeyManager] Failed to initialize uIOhook - permission denied')
      return false
    }
    if (generation !== this.uiohookGeneration) return false

    hook.on('keydown', (e: { keycode: number }) => {
      this.pressedKeys.add(e.keycode)
    })

    hook.on('keyup', (e: { keycode: number }) => {
      this.pressedKeys.delete(e.keycode)

      // If we're recording in push-to-talk mode, check if the hotkey is still pressed
      // (skip during combined detection window — tap handler manages release there)
      if (this.isRecording && this.currentMode === 'push-to-talk' && !this.pendingCombinedPress) {
        if (!this.areAllKeysPressed(this.pushToTalkKeyGroups)) {
          console.log('[HotkeyManager] Push-to-talk keys released (keyup event)')
          this.stopPushToTalkRecording()
        }
      }

      // Combined hold detection: tap detected via keyup event — switch mode in-place, pill stays open
      if (this.pendingCombinedPress && !this.areAllKeysPressed(this.combinedKeyGroups)) {
        this.pendingCombinedPress = false
        if (this.combinedHoldTimeout) {
          clearTimeout(this.combinedHoldTimeout)
          this.combinedHoldTimeout = null
        }
        // Recording already started (push-to-talk visual); just switch to transcription toggle in-place
        this.currentMode = 'transcription'
        this.activeToggles.add('transcription')
        console.log('[HotkeyManager] Combined: tap (keyup), switched to transcription')
      }

      // If we're in hold detection phase (pending), check if keys are released (tap detection)
      if (this.pendingPanelHotkey) {
        const panel = this.pendingPanelHotkey
        const keyGroups = this.panelKeyGroups.get(panel)
        if (keyGroups && !this.areAllKeysPressed(keyGroups)) {
          console.log(
            `[HotkeyManager] Panel ${panel} keys released during hold detection (keyup event) - tap`
          )
          this.handlePanelTap(panel)
        }
      }

      // If we're recording in panel mode, check if the panel hotkey is still pressed
      if (this.activePanelRecording) {
        const panel = this.activePanelRecording
        const keyGroups = this.panelKeyGroups.get(panel)
        if (keyGroups && !this.areAllKeysPressed(keyGroups)) {
          console.log(`[HotkeyManager] Panel ${panel} keys released (keyup event)`)
          this.stopPanelHotkeyRecording()
        }
      }
    })

    try {
      hook.start()
      this.uiohookStarted = true
      console.log('[HotkeyManager] uIOhook started for key release monitoring')
      return true
    } catch (error) {
      hook.removeAllListeners()
      console.error('[HotkeyManager] Failed to start uIOhook:', error)
      return false
    }
  }

  /**
   * Combined hotkey handler: tap -> toggle transcription, hold -> push-to-talk
   */
  private handleCombinedHotkeyPress(): void {
    // Debounce: ignore key-repeat fires after stopping transcription
    if (Date.now() < this.combinedDebounceUntil) return

    if (this.activeToggles.has('transcription')) {
      this.activeToggles.delete('transcription')
      this.isRecording = false
      this.currentMode = null
      this.recordingStartTime = null
      this.combinedDebounceUntil = Date.now() + this.COMBINED_DEBOUNCE_MS
      this.callbacks?.onRecordingStop('transcription')
      return
    }
    if (this.isRecording || this.pendingCombinedPress) return

    // Start recording immediately for instant pill expansion
    this.pendingCombinedPress = true
    this.isRecording = true
    this.currentMode = 'push-to-talk'
    this.recordingStartTime = Date.now()
    this.callbacks?.onRecordingStart('push-to-talk')

    // After threshold: commit to push-to-talk (recording already active, just start release monitor)
    this.combinedHoldTimeout = setTimeout(() => {
      if (!this.pendingCombinedPress) return
      this.pendingCombinedPress = false
      console.log('[HotkeyManager] Combined: hold threshold committed, monitoring for release')
      this.monitorKeyRelease()
    }, this.COMBINED_HOLD_THRESHOLD_MS)
    this.monitorCombinedKeyForTap()
  }

  private monitorCombinedKeyForTap(): void {
    const checkInterval = setInterval(() => {
      if (!this.pendingCombinedPress) {
        clearInterval(checkInterval)
        return
      }
      if (!this.areAllKeysPressed(this.combinedKeyGroups)) {
        clearInterval(checkInterval)
        this.pendingCombinedPress = false
        if (this.combinedHoldTimeout) {
          clearTimeout(this.combinedHoldTimeout)
          this.combinedHoldTimeout = null
        }
        // Recording already started (push-to-talk visual); switch mode in-place, no cancel/reopen
        this.currentMode = 'transcription'
        this.activeToggles.add('transcription')
        console.log('[HotkeyManager] Combined: tap (poll), switched to transcription')
      }
    }, 10)
  }

  /**
   * Start push-to-talk recording (called by globalShortcut)
   * Then monitor key state via uIOhook to detect release
   */
  private startPushToTalkRecording(): void {
    if (this.isRecording) {
      console.log('[HotkeyManager] Already recording, ignoring')
      return
    }

    // Start recording
    this.isRecording = true
    this.currentMode = 'push-to-talk'
    this.recordingStartTime = Date.now()
    console.log('[HotkeyManager] Push-to-talk recording started via globalShortcut')
    this.callbacks?.onRecordingStart('push-to-talk')

    // Start monitoring key state via uIOhook
    this.monitorKeyRelease()
  }

  /**
   * Stop push-to-talk recording and check if it was a quick release
   * If duration < MIN_RECORDING_DURATION_MS, cancel the recording
   * Otherwise, process it normally
   */
  private stopPushToTalkRecording(): void {
    if (!this.isRecording || this.currentMode !== 'push-to-talk') {
      return
    }

    const duration = this.recordingStartTime ? Date.now() - this.recordingStartTime : 0

    // Reset recording state
    this.isRecording = false
    this.currentMode = null
    this.recordingStartTime = null

    // Check if this was a quick release (accidental press)
    if (duration < this.MIN_RECORDING_DURATION_MS) {
      console.log(`[HotkeyManager] Quick release detected (${duration}ms), canceling recording`)
      this.callbacks?.onRecordingCancel('push-to-talk')
    } else {
      console.log(`[HotkeyManager] Recording stopped normally (${duration}ms)`)
      this.callbacks?.onRecordingStop('push-to-talk')
    }
  }

  /**
   * Monitor key state to detect when push-to-talk keys are released
   * Uses a polling approach with uIOhook's key state tracking
   */
  private monitorKeyRelease(): void {
    const checkInterval = setInterval(() => {
      // If recording stopped by other means, clear interval
      if (!this.isRecording || this.currentMode !== 'push-to-talk') {
        clearInterval(checkInterval)
        return
      }

      // Check if all push-to-talk keys are still pressed
      if (!this.areAllKeysPressed(this.pushToTalkKeyGroups)) {
        // Keys released, stop recording
        clearInterval(checkInterval)
        this.stopPushToTalkRecording()
      }
    }, 50) // Check every 50ms for responsive key release detection
  }

  /**
   * Register a hotkey for a specific mode
   *
   * Hybrid approach for push-to-talk:
   * - Uses globalShortcut to detect key press (suppresses key events automatically)
   * - Uses uIOhook to monitor key state and detect release
   */
  registerHotkey(mode: HotkeyMode, displayHotkey: string): boolean {
    if (!displayHotkey) {
      this.configuredHotkeys.delete(mode)
      this.unregisterHotkey(mode)
      return true
    }

    this.configuredHotkeys.set(mode, displayHotkey)

    try {
      console.log(`[HotkeyManager] Registering ${mode}: ${displayHotkey}`)

      if (mode === 'push-to-talk') {
        if (!hasAccessibilityPermission()) {
          console.log(
            `[HotkeyManager] Cannot register push-to-talk - accessibility permission not granted`
          )
          return false
        }

        const accelerator = this.convertToAccelerator(displayHotkey)

        // Unregister previous (re-registers transcription individually if breaking combined mode)
        this.unregisterHotkey(mode, false)

        // Set keycodes AFTER unregisterHotkey (which clears pushToTalkKeyGroups)
        this.pushToTalkKeyGroups = this.convertToKeycodes(displayHotkey)

        // If transcription already uses this accelerator, activate combined mode
        const transcriptionAcc = this.registeredHotkeys.get('transcription')
        if (transcriptionAcc === accelerator) {
          globalShortcut.unregister(accelerator)
          const success = globalShortcut.register(accelerator, () => {
            if (!settingsService.isAuthenticated) return
            this.handleCombinedHotkeyPress()
          })
          if (success) {
            this.registeredHotkeys.set('push-to-talk', accelerator)
            this.registeredHotkeys.set('transcription', accelerator)
            this.combinedHotkeyAccelerator = accelerator
            this.combinedKeyGroups = this.pushToTalkKeyGroups
            this.startUIOhook()
            console.log(`[HotkeyManager] Combined mode activated: ${accelerator}`)
          } else {
            console.error(`[HotkeyManager] Failed to register combined hotkey: ${accelerator}`)
          }
          return success
        }

        // Normal push-to-talk registration
        const success = globalShortcut.register(accelerator, () => {
          if (!settingsService.isAuthenticated) return
          this.startPushToTalkRecording()
        })
        if (success) {
          this.registeredHotkeys.set(mode, accelerator)
          this.startUIOhook().then((started) => {
            if (!started) console.warn(`[HotkeyManager] uIOhook not started for push-to-talk`)
          })
          console.log(
            `[HotkeyManager] Push-to-talk registered: ${accelerator}`,
            this.pushToTalkKeyGroups
          )
        } else {
          console.error(`[HotkeyManager] Failed to register push-to-talk: ${accelerator}`)
        }
        return success
      } else if (mode === 'transcription') {
        const accelerator = this.convertToAccelerator(displayHotkey)

        // Unregister previous (re-registers push-to-talk individually if breaking combined mode)
        this.unregisterHotkey(mode, false)

        // If push-to-talk already uses this accelerator, activate combined mode
        const pushToTalkAcc = this.registeredHotkeys.get('push-to-talk')
        if (pushToTalkAcc === accelerator) {
          globalShortcut.unregister(accelerator)
          const success = globalShortcut.register(accelerator, () => {
            if (!settingsService.isAuthenticated) return
            this.handleCombinedHotkeyPress()
          })
          if (success) {
            this.registeredHotkeys.set('transcription', accelerator)
            this.registeredHotkeys.set('push-to-talk', accelerator)
            this.combinedHotkeyAccelerator = accelerator
            this.combinedKeyGroups = this.pushToTalkKeyGroups
            this.startUIOhook()
            console.log(`[HotkeyManager] Combined mode activated: ${accelerator}`)
          } else {
            console.error(`[HotkeyManager] Failed to register combined hotkey: ${accelerator}`)
          }
          return success
        }

        // Normal transcription registration
        const success = globalShortcut.register(accelerator, () => {
          if (!settingsService.isAuthenticated) return
          this.handleToggleHotkey('transcription')
        })
        if (success) {
          this.registeredHotkeys.set(mode, accelerator)
          console.log(`[HotkeyManager] Transcription registered: ${accelerator}`)
        } else {
          console.error(`[HotkeyManager] Failed to register transcription: ${accelerator}`)
        }
        return success
      } else {
        // Use globalShortcut for other toggle modes (assistant)
        this.unregisterHotkey(mode, false)
        const accelerator = this.convertToAccelerator(displayHotkey)
        const success = globalShortcut.register(accelerator, () => {
          if (!settingsService.isAuthenticated) return
          this.handleToggleHotkey(mode)
        })
        if (success) {
          this.registeredHotkeys.set(mode, accelerator)
          console.log(`[HotkeyManager] Registered ${mode}: ${accelerator}`)
        } else {
          console.error(`[HotkeyManager] Failed to register ${mode}: ${accelerator}`)
        }
        return success
      }
    } catch (error) {
      console.error(`[HotkeyManager] Error registering ${mode} hotkey:`, error)
      return false
    }
  }

  /**
   * Handle toggle hotkey press (transcription, assistant)
   */
  private handleToggleHotkey(mode: HotkeyMode): void {
    if (!this.callbacks) {
      console.error('[HotkeyManager] No callbacks registered')
      return
    }

    if (this.activeToggles.has(mode)) {
      // Stop recording
      this.activeToggles.delete(mode)
      this.isRecording = false
      this.currentMode = null
      this.recordingStartTime = null
      this.callbacks.onRecordingStop(mode)
    } else {
      // Start recording
      this.activeToggles.add(mode)
      this.isRecording = true
      this.currentMode = mode
      this.recordingStartTime = Date.now()
      this.callbacks.onRecordingStart(mode)
    }
  }

  /**
   * Unregister a hotkey for a specific mode.
   * When in combined mode (transcription + push-to-talk share same accelerator),
   * unregistering one re-registers the other individually so it keeps working.
   */
  unregisterHotkey(mode: HotkeyMode, removeConfiguration = true): void {
    if (removeConfiguration) this.configuredHotkeys.delete(mode)
    if (this.combinedHotkeyAccelerator && (mode === 'transcription' || mode === 'push-to-talk')) {
      const combinedAcc = this.combinedHotkeyAccelerator
      this.combinedHotkeyAccelerator = null
      this.combinedKeyGroups = []
      // Unregister the shared combined handler
      globalShortcut.unregister(combinedAcc)
      this.registeredHotkeys.delete('transcription')
      this.registeredHotkeys.delete('push-to-talk')
      // Re-register the other mode individually so it keeps working
      if (mode === 'push-to-talk') {
        // Keep transcription working individually
        const ok = globalShortcut.register(combinedAcc, () => {
          if (!settingsService.isAuthenticated) return
          this.handleToggleHotkey('transcription')
        })
        if (ok) this.registeredHotkeys.set('transcription', combinedAcc)
      } else {
        // Keep push-to-talk working individually
        const ok = globalShortcut.register(combinedAcc, () => {
          if (!settingsService.isAuthenticated) return
          this.startPushToTalkRecording()
        })
        if (ok) this.registeredHotkeys.set('push-to-talk', combinedAcc)
      }
      if (mode === 'push-to-talk') this.pushToTalkKeyGroups = []
      return
    }
    const accelerator = this.registeredHotkeys.get(mode)
    if (accelerator) {
      globalShortcut.unregister(accelerator)
      this.registeredHotkeys.delete(mode)
      console.log(`[HotkeyManager] Unregistered ${mode} hotkey`)
      if (mode === 'push-to-talk') this.pushToTalkKeyGroups = []
    }
  }

  recoverHotkeys(): boolean {
    const hotkeyConfigurations = new Map(this.configuredHotkeys)
    const panelConfigurations = new Map(this.configuredPanelHotkeys)
    const interruptedMode = this.currentMode

    globalShortcut.unregisterAll()
    this.registeredHotkeys.clear()
    this.registeredPanelHotkeys.clear()
    this.activeToggles.clear()
    this.pushToTalkKeyGroups = []
    this.panelKeyGroups.clear()
    this.pressedKeys.clear()
    this.isRecording = false
    this.currentMode = null
    this.recordingStartTime = null
    this.activePanelRecording = null
    this.panelRecordingStartTime = null
    this.panelWasVisibleBeforeRecording = false
    this.combinedHotkeyAccelerator = null
    this.combinedKeyGroups = []
    this.pendingCombinedPress = false
    this.combinedDebounceUntil = 0
    this.pendingPanelHotkey = null
    this.pendingPanelWasVisible = false
    this.pendingPanelOpenedOnKeydown = false
    this.lastPanelShownAt.clear()

    if (this.combinedHoldTimeout) {
      clearTimeout(this.combinedHoldTimeout)
      this.combinedHoldTimeout = null
    }
    if (this.panelHoldTimeout) {
      clearTimeout(this.panelHoldTimeout)
      this.panelHoldTimeout = null
    }
    this.uiohookGeneration++
    if (uIOhookInstance) {
      try {
        uIOhookInstance.removeAllListeners()
        if (this.uiohookStarted) uIOhookInstance.stop()
      } catch (error) {
        console.warn('[HotkeyManager] Failed to stop uIOhook during recovery:', error)
      }
    }
    this.uiohookStarted = false
    this.uiohookStartPromise = null

    if (interruptedMode) this.callbacks?.onRecordingCancel(interruptedMode)

    const hotkeyOrder: HotkeyMode[] = [
      'transcription',
      'push-to-talk',
      'assistant',
      'panel-chat',
      'panel-notebook'
    ]
    for (const mode of hotkeyOrder) {
      const displayHotkey = hotkeyConfigurations.get(mode)
      if (displayHotkey) this.registerHotkey(mode, displayHotkey)
    }

    const panelOrder: PanelToggleMode[] = ['chat', 'notebook', 'browser']
    for (const panel of panelOrder) {
      const displayHotkey = panelConfigurations.get(panel)
      if (displayHotkey) this.registerPanelHotkey(panel, displayHotkey)
    }

    const recovered = this.areConfiguredHotkeysRegistered()
    console.log(`[HotkeyManager] Hotkey recovery ${recovered ? 'completed' : 'incomplete'}`)
    return recovered
  }

  ensureHotkeysRegistered(): boolean {
    if (this.areRegisteredHotkeysActive()) return true
    console.warn('[HotkeyManager] Detected missing global shortcut registration')
    return this.recoverHotkeys()
  }

  private areRegisteredHotkeysActive(): boolean {
    const registeredAccelerators = [
      ...this.registeredHotkeys.values(),
      ...this.registeredPanelHotkeys.values()
    ]
    if (registeredAccelerators.length === 0) {
      return this.configuredHotkeys.size === 0 && this.configuredPanelHotkeys.size === 0
    }
    return registeredAccelerators.every((accelerator) => globalShortcut.isRegistered(accelerator))
  }

  private areConfiguredHotkeysRegistered(): boolean {
    const configuredAccelerators = [
      ...this.configuredHotkeys.values(),
      ...this.configuredPanelHotkeys.values()
    ].map((hotkey) => this.convertToAccelerator(hotkey))
    return configuredAccelerators.every((accelerator) => globalShortcut.isRegistered(accelerator))
  }

  /**
   * Unregister all hotkeys and cleanup
   */
  unregisterAll(): void {
    globalShortcut.unregisterAll()
    this.registeredHotkeys.clear()
    this.registeredPanelHotkeys.clear()
    this.configuredHotkeys.clear()
    this.configuredPanelHotkeys.clear()
    this.activeToggles.clear()
    this.pushToTalkKeyGroups = []
    this.panelKeyGroups.clear()
    this.pressedKeys.clear()
    this.isRecording = false
    this.currentMode = null
    this.recordingStartTime = null
    this.activePanelRecording = null
    this.panelRecordingStartTime = null
    this.panelWasVisibleBeforeRecording = false

    // Clear combined hotkey state
    this.combinedHotkeyAccelerator = null
    this.combinedKeyGroups = []
    this.pendingCombinedPress = false
    this.combinedDebounceUntil = 0
    if (this.combinedHoldTimeout) {
      clearTimeout(this.combinedHoldTimeout)
      this.combinedHoldTimeout = null
    }

    // Clear hold detection state
    this.pendingPanelHotkey = null
    this.pendingPanelWasVisible = false
    this.pendingPanelOpenedOnKeydown = false
    this.lastPanelShownAt.clear()
    if (this.panelHoldTimeout) {
      clearTimeout(this.panelHoldTimeout)
      this.panelHoldTimeout = null
    }

    this.uiohookGeneration++
    if (this.uiohookStarted && uIOhookInstance) {
      uIOhookInstance.removeAllListeners()
      try {
        uIOhookInstance.stop()
      } catch {
        // Ignore errors on stop
      }
      this.uiohookStarted = false
    }
    this.uiohookStartPromise = null

    console.log('[HotkeyManager] Unregistered all hotkeys')
  }

  /**
   * Check if a specific mode is currently active
   */
  isActive(mode: HotkeyMode): boolean {
    return this.activeToggles.has(mode) || (this.isRecording && this.currentMode === mode)
  }

  /**
   * Get current recording state
   */
  getRecordingState(): { isRecording: boolean; mode: HotkeyMode | null } {
    return {
      isRecording: this.isRecording,
      mode: this.currentMode
    }
  }
}

// Export singleton instance
export const hotkeyManager = new HotkeyManager()

// Export permission check for use in other modules
export { hasAccessibilityPermission }
