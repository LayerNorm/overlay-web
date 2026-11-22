import { Image } from 'expo-image'
import React from 'react'
import { Pressable, Text, View, useWindowDimensions } from 'react-native'
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

/**
 * Options for the first screen of a tab: the title sits in the navigation bar
 * itself, leading, on the same row as the trailing buttons (no separate
 * large-title row, so content starts right under the bar).
 */
export function useTabRootOptions(title: string): NativeStackNavigationOptions {
  const { theme } = useTheme()
  return {
    title: '',
    headerLargeTitle: false,
    unstable_headerLeftItems: () => [
      {
        type: 'custom',
        hidesSharedBackground: true,
        element: (
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={{ fontFamily: 'GeistSemibold', fontSize: 28, letterSpacing: -0.6, color: theme.foreground }}
          >
            {title}
          </Text>
        ),
      },
    ],
  }
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

/**
 * Navigation bar for a conversation (agent thread, DM, channel, personal
 * chat): an opaque bar so the transcript and keyboard handling keep their
 * layout, with an avatar + title/subtitle in the center and actions in the
 * trailing toolbar (pass `Stack.Toolbar.*` items as children).
 */
export function ConversationHeader({
  title,
  subtitle,
  avatar,
  onPressTitle,
  children,
}: {
  title: string
  subtitle?: string
  avatar?: React.ReactNode
  onPressTitle?: () => void
  children?: React.ReactNode
}) {
  const { theme } = useTheme()
  const { width } = useWindowDimensions()
  // Leave room for the back button and the trailing toolbar buttons.
  const titleWidth = Math.max(140, width - (avatar ? 150 : 200))
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: false,
          headerLargeTitle: false,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.foreground,
          headerBackButtonDisplayMode: 'minimal',
          title,
          headerTitleStyle: { fontFamily: 'GeistSemibold', color: theme.foreground },
          // A plain title uses the system label (native centering and truncation).
          headerTitle: !avatar && !subtitle ? undefined : () => (
            <Pressable
              accessibilityRole={onPressTitle ? 'button' : 'header'}
              accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
              disabled={!onPressTitle}
              onPress={onPressTitle}
              style={({ pressed }) => ({
                maxWidth: titleWidth,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                // With an avatar the identity sits in a tappable capsule.
                ...(avatar
                  ? {
                      paddingLeft: 5,
                      paddingRight: 12,
                      height: 40,
                      borderRadius: 20,
                      gap: 7,
                      backgroundColor: pressed ? theme.surfaceMuted : theme.surfaceSubtle,
                    }
                  : {}),
              })}
            >
              {avatar}
              <View style={{ flexShrink: 1, alignItems: avatar ? 'flex-start' : 'center' }}>
                <Text
                  numberOfLines={1}
                  style={{ fontFamily: 'GeistSemibold', fontSize: 15, letterSpacing: -0.2, color: theme.foreground }}
                >
                  {title}
                </Text>
                {subtitle ? (
                  <Text numberOfLines={1} style={{ fontFamily: 'Geist', fontSize: 11, color: theme.muted }}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              {avatar && onPressTitle ? (
                <Image source="sf:chevron.right" style={{ width: 6, height: 10 }} contentFit="contain" tintColor={theme.mutedLight as string} />
              ) : null}
            </Pressable>
          ),
        }}
      />
      {children ? <Stack.Toolbar placement="right">{children}</Stack.Toolbar> : null}
    </>
  )
}
