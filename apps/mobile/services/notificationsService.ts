import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

/**
 * Push + foreground notification plumbing.
 *
 * Two layers:
 * Token capture is separate from authenticated backend registration. Local
 * banners remain a fallback when a device cannot register an Expo token.
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
let remoteFilter: ((url: string) => Promise<boolean>) | null = null
export function setRemoteNotificationFilter(filter: typeof remoteFilter) {
  remoteFilter = filter
}

export function initNotificationHandler(): void {
  if (handlerInstalled) return
  handlerInstalled = true
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const url = notification?.request?.content?.data?.url
      const show = typeof url !== 'string' || Boolean(await remoteFilter?.(url).catch(() => false))
      return {
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: show,
        shouldShowList: show,
      }
    },
  })
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android')
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.DEFAULT,
    })
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
 * way the token is stored locally; only Expo tokens can be registered remotely.
 */
export async function preparePushRegistration(
  userId: string,
  allowPrompt = true,
  shouldPersist: () => boolean = () => true,
): Promise<StoredPushToken | null> {
  if (!Device.isDevice) return null
  const granted = allowPrompt
    ? await requestNotificationPermission()
    : (await Notifications.getPermissionsAsync()).granted
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
  if (!shouldPersist()) return null
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
 * Fires an immediate local notification — the foreground banner for activity
 * that arrives while the app is open, and the fallback when this device has no
 * server push registration. `data` carries routing info for the response
 * listener in `_layout`.
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
