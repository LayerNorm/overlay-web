import AsyncStorage from '@react-native-async-storage/async-storage'
export const BANNER_CATEGORIES = ['dm', 'mention', 'thread', 'reaction', 'channel'] as const
export type BannerCategory = (typeof BANNER_CATEGORIES)[number]
export type BannerPreferences = Record<BannerCategory, boolean>
export const DEFAULT_BANNER_PREFERENCES: BannerPreferences = {
  dm: true,
  mention: true,
  thread: true,
  reaction: true,
  channel: true,
}
const key = (userId: string) => `overlay-banner-preferences:${userId}`
export async function loadBannerPreferences(userId: string): Promise<BannerPreferences> {
  const raw = await AsyncStorage.getItem(key(userId))
  try {
    const stored = JSON.parse(raw ?? '{}') as Partial<BannerPreferences>
    return Object.fromEntries(
      BANNER_CATEGORIES.map((category) => [
        category,
        typeof stored?.[category] === 'boolean' ? stored[category] : true,
      ]),
    ) as BannerPreferences
  } catch {
    return { ...DEFAULT_BANNER_PREFERENCES }
  }
}
export async function saveBannerPreferences(userId: string, value: BannerPreferences) {
  await AsyncStorage.setItem(key(userId), JSON.stringify(value))
}
export function allowsBanner(
  preferences: BannerPreferences,
  type: string,
  conversationType?: string,
) {
  if (type === 'message')
    return conversationType === 'dm'
      ? preferences.dm
      : conversationType === 'channel'
        ? preferences.channel
        : preferences.dm && preferences.channel
  const category = type === 'dm_message' ? 'dm' : type === 'channel_message' ? 'channel' : type
  return (
    !BANNER_CATEGORIES.includes(category as BannerCategory) ||
    preferences[category as BannerCategory]
  )
}
