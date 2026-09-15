import React from 'react'
import { Platform } from 'react-native'
import { Image } from 'expo-image'
import { Feather } from '@expo/vector-icons'

export type FeatherIconName = React.ComponentProps<typeof Feather>['name']

/**
 * Platform-native icon: SF Symbols on iOS (via expo-image `sf:` sources),
 * Feather elsewhere. Prefer this over a raw icon import so iOS surfaces pick
 * up the system symbol set while Android/web keep working.
 */
export function AppIcon({
  sfSymbol,
  featherIcon,
  size = 18,
  color,
}: {
  sfSymbol: string
  featherIcon: FeatherIconName
  size?: number
  color: string
}): React.ReactElement {
  if (Platform.OS === 'ios') {
    return (
      <Image
        source={`sf:${sfSymbol}`}
        style={{ width: size, height: size }}
        tintColor={color}
        contentFit="contain"
      />
    )
  }
  return <Feather name={featherIcon} size={size} color={color} />
}
