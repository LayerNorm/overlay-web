import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

/**
 * Push + foreground notification plumbing.
 *
 * Two layers:
 * 1. Registration groundwork — permission + native/Expo push token captured
 *    and persisted locally (`overlay-push-token:<uid>`) so the deferred
 *    server token-store endpoint (plan §9.3) only needs the upload call.
 * 2. Foreground in-app banners — while the server has no push fan-out, the
 *    unread-notification watcher fires local notifications; the handler
 *    below lets them present as real in-app banners instead of being
 *    swallowed by the foreground default.
 */

const PUSH_TOKEN_KEY_PREFIX = 'overlay-push-token'

export interface StoredPushToken {
  token: string
  type: 'expo' | 'device'
  platform: string
  userId: string
  updatedAt: number
}

let handlerInstalled = false

export function initNotificationHandler(): void {
  if (handlerInstalled) return
  handlerInstalled = true
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  })
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: 'Default', importance: Notifications.AndroidImportance.DEFAULT })
  const current = await Notifications.getPermissionsAsync()
  if (current.granted) return true
  if (!current.canAskAgain) return false
  const requested = await Notifications.requestPermissionsAsync()
  return requested.granted
}

/**
 * Captures the best available push token and persists it under the user id.
 * Expo push tokens need an EAS projectId; when the project config lacks one
 * (local dev builds) we fall back to the raw APNs/FCM device token. Either
 * way the token is stored so the §9 endpoint only needs an upload call.
 */
export async function preparePushRegistration(userId: string): Promise<StoredPushToken | null> {
  if (!Device.isDevice) return null
  const granted = await requestNotificationPermission()
  if (!granted) return null
  let stored: StoredPushToken | null = null
  try {
    const expoToken = await Notifications.getExpoPushTokenAsync()
    stored = {
      token: expoToken.data,
      type: 'expo',
      platform: Platform.OS,
      userId,
      updatedAt: Date.now(),
    }
  } catch {
    try {
      const deviceToken = await Notifications.getDevicePushTokenAsync()
      stored = {
        token: deviceToken.data,
        type: 'device',
        platform: Platform.OS,
        userId,
        updatedAt: Date.now(),
      }
    } catch {
      stored = null
    }
  }
  if (stored) {
    await AsyncStorage.setItem(`${PUSH_TOKEN_KEY_PREFIX}:${userId}`, JSON.stringify(stored))
  }
  return stored
}

export async function getStoredPushToken(userId: string): Promise<StoredPushToken | null> {
  const raw = await AsyncStorage.getItem(`${PUSH_TOKEN_KEY_PREFIX}:${userId}`)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredPushToken
  } catch {
    return null
  }
}

/**
 * Fires an immediate local notification — the foreground-banner mechanism
 * used until server push exists (§9.3). `data` carries routing info for the
 * response listener in `_layout`.
 */
export async function presentLocalBanner(input: {
  title: string
  body?: string
  data?: Record<string, unknown>
}): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: input.title,
        body: input.body,
        data: input.data ?? {},
        sound: false,
      },
      trigger: null,
    })
  } catch {
    // Notification scheduling is best-effort; never crash a poll cycle.
  }
}

export function addNotificationResponseListener(
  listener: (response: Notifications.NotificationResponse) => void,
): Notifications.EventSubscription {
  return Notifications.addNotificationResponseReceivedListener(listener)
}
