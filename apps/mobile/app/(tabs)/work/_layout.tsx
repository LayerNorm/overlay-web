import React from 'react'
import { Stack } from 'expo-router'
import { useNativeHeaderOptions, useTabRootOptions } from '../../../components/navigation/nativeHeader'

export const unstable_settings = { initialRouteName: 'index' }

// Task forms open as native sheets with their own bar (Cancel / ✓).
const formSheet = {
  headerLargeTitle: false,
  headerTransparent: true,
  contentStyle: undefined,
  presentation: 'formSheet',
  sheetGrabberVisible: true,
  sheetCornerRadius: 28,
} as const

export default function WorkLayout(): React.ReactElement {
  const header = useNativeHeaderOptions()
  return (
    <Stack screenOptions={header}>
      <Stack.Screen name="index" options={useTabRootOptions('Work')} />
      <Stack.Screen name="new" options={{ ...header, ...formSheet, title: 'New task', sheetAllowedDetents: [1] }} />
      <Stack.Screen name="schedule" options={{ ...header, ...formSheet, title: 'Schedule', sheetAllowedDetents: [0.6, 1] }} />
      <Stack.Screen name="organization" options={{ title: 'Organization', headerLargeTitle: false }} />
    </Stack>
  )
}
