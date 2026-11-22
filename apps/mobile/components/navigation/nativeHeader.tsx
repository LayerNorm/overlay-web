import React from 'react'
import { Stack, useRouter } from 'expo-router'
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack'
import { useTheme } from '../../hooks/useTheme'

/**
 * Native iOS navigation bar for every stack: system back button, large
 * titles that collapse on scroll, and the system scroll-edge material
 * (Liquid Glass on iOS 26). Screens put their scroll view first with
 * `contentInsetAdjustmentBehavior="automatic"` so content sits below it.
 */
export function useNativeHeaderOptions(): NativeStackNavigationOptions {
  const { theme } = useTheme()
  return {
    headerShown: true,
    headerTransparent: true,
    headerShadowVisible: false,
    headerLargeTitleShadowVisible: false,
    headerBackButtonDisplayMode: 'minimal',
    headerTintColor: theme.foreground,
    headerTitleStyle: { fontFamily: 'GeistSemibold', color: theme.foreground },
    headerLargeTitleStyle: { fontFamily: 'GeistSemibold', color: theme.foreground },
    contentStyle: { backgroundColor: theme.background },
  }
}

/** Options for the first screen of a tab: large title. */
export function tabRootOptions(title: string): NativeStackNavigationOptions {
  return { title, headerLargeTitle: true }
}

/**
 * Trailing header items for a tab's root screen. Screen-specific buttons
 * and menus go first; the account button is always last.
 */
export function TabToolbar({ children }: { children?: React.ReactNode }) {
  const router = useRouter()
  return (
    <Stack.Toolbar placement="right">
      {children}
      <Stack.Toolbar.Button
        icon="person.crop.circle"
        accessibilityLabel="Account"
        onPress={() => router.push('/account')}
      />
    </Stack.Toolbar>
  )
}
