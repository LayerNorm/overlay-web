import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'
import * as Notifications from 'expo-notifications'
import { AppState, Platform } from 'react-native'
import { api, mutateConvex } from './convexClient'
import { loadAuthSession } from './authService'
import { preparePushRegistration, setRemoteNotificationFilter } from './notificationsService'
import { allowsBanner, loadBannerPreferences } from './bannerPreferencesService'
import { parsePushUrl } from '../lib/pushRoutes'

const DEVICE_KEY = 'overlay-push-device-id'
let activeUser: string | null = null
let generation = 0
let registered: string | null = null
let registeredToken: string | null = null
let queue: Promise<unknown> = Promise.resolve()
let flight: { generation: number; promise: Promise<void> } | null = null

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation)
  queue = next.catch(() => undefined)
  return next
}
function bounded<T>(promise: Promise<T>, milliseconds = 10000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Could not update device notifications. Try again when connected.')),
      milliseconds,
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
export const hasRegisteredPushToken = (userId: string) => registered === userId

export async function syncPushRegistration(userId: string): Promise<void> {
  if (activeUser !== userId) return
  if (flight?.generation === generation) return flight.promise
  const version = generation
  const current = () => generation === version && activeUser === userId
  const promise = enqueue(async () => {
    if (!current()) return
    if (!(await Notifications.getPermissionsAsync()).granted) {
      const deviceId = await AsyncStorage.getItem(DEVICE_KEY)
      if (deviceId && current())
        await bounded(mutateConvex(api.notifications.tokens.unregister, { deviceId }))
      registered = null
      registeredToken = null
      return
    }
    const stored = await bounded(preparePushRegistration(userId, false, current))
    if (!current()) return
    if (!stored || stored.type !== 'expo')
      throw new Error(
        'Device permission is saved, but an Expo push token is unavailable. Check this app’s notification setup.',
      )
    if ((await loadAuthSession())?.user.id !== userId || !current()) return
    let deviceId = await AsyncStorage.getItem(DEVICE_KEY)
    if (!deviceId) {
      deviceId = Crypto.randomUUID()
      await AsyncStorage.setItem(DEVICE_KEY, deviceId)
    }
    if (!current()) return
    if (registered === userId && registeredToken === stored.token) return
    if (stored.platform !== 'ios' && stored.platform !== 'android') return
    await bounded(
      mutateConvex(api.notifications.tokens.register, {
        expoToken: stored.token,
        platform: stored.platform,
        deviceId,
      }),
    )
    if (current()) {
      registered = userId
      registeredToken = stored.token
    }
  })
  flight = { generation: version, promise }
  try {
    await promise
  } finally {
    if (flight?.promise === promise) flight = null
  }
}

export function startPushRegistration(userId: string): () => void {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return () => undefined
  activeUser = userId
  const version = ++generation
  registered = null
  registeredToken = null
  const refresh = () => {
    void syncPushRegistration(userId).catch(() =>
      console.warn('[Push] Device registration unavailable; retry on foreground or token change.'),
    )
  }
  setRemoteNotificationFilter(async (url) => {
    const route = parsePushUrl(url)
    if (!route || activeUser !== userId || version !== generation) return false
    const preferences = await loadBannerPreferences(userId)
    return (
      activeUser === userId &&
      version === generation &&
      allowsBanner(
        preferences,
        route.notificationType ?? 'mention',
        route.kind === 'channel' ? 'channel' : 'dm',
      )
    )
  })
  const tokenListener = Notifications.addPushTokenListener(refresh)
  const appListener = AppState.addEventListener('change', (state) => {
    if (state === 'active') refresh()
  })
  refresh()
  return () => {
    tokenListener.remove()
    appListener.remove()
    if (version === generation) {
      generation++
      activeUser = null
      registered = null
      registeredToken = null
      setRemoteNotificationFilter(null)
    }
  }
}

export async function unregisterPushRegistration(userId: string): Promise<void> {
  generation++
  activeUser = null
  registered = null
  registeredToken = null
  setRemoteNotificationFilter(null)
  try {
    await bounded(
      enqueue(async () => {
        const deviceId = await AsyncStorage.getItem(DEVICE_KEY)
        if (deviceId && (await loadAuthSession())?.user.id === userId)
          await bounded(mutateConvex(api.notifications.tokens.unregister, { deviceId }), 3000)
      }),
      3000,
    )
  } catch {
    console.warn('[Push] Device unregister unavailable during local sign-out.')
  }
  await Promise.allSettled([
    AsyncStorage.removeItem(`overlay-push-token:${userId}`),
    Notifications.clearLastNotificationResponseAsync(),
    Notifications.dismissAllNotificationsAsync(),
  ])
}
