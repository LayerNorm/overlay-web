import * as Haptics from 'expo-haptics'
import {
  DEFAULT_MOBILE_PREFERENCES,
  loadMobilePreferences,
  subscribeMobilePreferences,
} from '../services/mobilePreferencesService'

/**
 * Preference-gated haptics. All call sites route through these helpers so the
 * Settings → Haptics toggle is honored everywhere, including fire-and-forget
 * calls inside JSX handlers that can't read the preferences hook.
 */

let enabled = DEFAULT_MOBILE_PREFERENCES.hapticsEnabled
let initialized = false

function ensureInit(): void {
  if (initialized) return
  initialized = true
  void loadMobilePreferences().then((prefs) => {
    enabled = prefs.hapticsEnabled
  })
  subscribeMobilePreferences((prefs) => {
    enabled = prefs.hapticsEnabled
  })
}

export function hapticImpact(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light): void {
  ensureInit()
  if (!enabled) return
  void Haptics.impactAsync(style).catch(() => undefined)
}

export function hapticNotify(
  type: Haptics.NotificationFeedbackType = Haptics.NotificationFeedbackType.Success,
): void {
  ensureInit()
  if (!enabled) return
  void Haptics.notificationAsync(type).catch(() => undefined)
}

export function hapticSelect(): void {
  ensureInit()
  if (!enabled) return
  void Haptics.selectionAsync().catch(() => undefined)
}
