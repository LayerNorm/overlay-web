import React from 'react'
import { Dimensions, View } from 'react-native'

export const DRAWER_WIDTH = Math.min(Dimensions.get('window').width * 0.85, 320)

export function ScreenWithDrawer({
  children,
}: {
  children: React.ReactNode
  drawer: React.ReactNode
}) {
  return <View style={{ flex: 1 }}>{children}</View>
}
