import React, { useEffect } from 'react'
import { View, ActivityIndicator, Alert } from 'react-native'
import { Stack, useGlobalSearchParams } from 'expo-router'
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native'
import { useNativeHeaderOptions } from '../components/navigation/nativeHeader'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useFonts } from 'expo-font'
import { DrawerProvider } from '../contexts/DrawerContext'
import { AppShell } from '../components/shell/AppShell'
import { SessionGate } from '../components/shell/SessionGate'
import { ThemeProvider, useTheme } from '../hooks/useTheme'
import { AuthProvider, useAuth } from '../contexts/AuthContext'
import { AppSessionProvider, useAppSession } from '../contexts/AppSessionContext'
import { WorkspaceProvider, useWorkspace } from '../contexts/WorkspaceContext'
import { activateLinkWorkspace } from '../lib/incomingLinks'
import { ConvexAuthProvider, useNativeDataReady } from '../contexts/ConvexAuthProvider'
import { SettingsLiveBridge } from '../components/settings/SettingsLiveBridge'
import { usePushNotifications } from '../hooks/usePushNotifications'
import { useNotificationWatcher } from '../hooks/useNotificationWatcher'
import { initNotificationHandler } from '../services/notificationsService'

initNotificationHandler()

function useVoiceAuthSync(): void {
  // Mirror the WorkOS access token + userId into the App Group on launch and
  // periodically thereafter so the headless recorder can authenticate against
  // /api/v1/transcribe even after a token refresh.
  useEffect(() => {
    let cancelled = false
    const sync = async () => {
      try {
        const { syncAuthSessionToAppGroup } = await import('../services/voiceService')
        if (!cancelled) await syncAuthSessionToAppGroup()
      } catch {
        // ignore
      }
    }
    void sync()
    const interval = setInterval(() => void sync(), 60_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])
}

function SessionScreenLayout({ children }: { children: React.ReactNode }) {
  return <SessionGate>{children}</SessionGate>
}

function RootLayoutNav(): React.ReactElement {
  const { isDark, theme } = useTheme()
  const { isAuthenticated } = useAuth()
  const { isInitialized } = useAppSession()
  const ready = useNativeDataReady()
  const { workspaceId } = useGlobalSearchParams<{ workspaceId?: string }>()
  const { activeWorkspaceId, isLoading, switchWorkspace } = useWorkspace()
  useEffect(() => {
    if (!ready || !isAuthenticated || !isInitialized || isLoading) return
    let current = true
    void activateLinkWorkspace(workspaceId, activeWorkspaceId, switchWorkspace).catch(() => {
      if (current) Alert.alert('Could not open workspace', 'Check your connection and workspace access.')
    })
    return () => { current = false }
  }, [workspaceId, activeWorkspaceId, isLoading, isAuthenticated, isInitialized, switchWorkspace, ready])
  useVoiceAuthSync()
  useNotificationWatcher(isAuthenticated && isInitialized)
  usePushNotifications(isInitialized)
  const nativeHeader = useNativeHeaderOptions()
  const conversationHeader = {
    ...nativeHeader,
    headerTransparent: false,
    headerLargeTitle: false,
    headerStyle: { backgroundColor: theme.background },
  }
  return (
    // Native UIKit chrome (toolbar menus, alerts, sheets) follows the app's
    // appearance, including an in-app Light/Dark choice that differs from the system.
    <NavigationThemeProvider value={isDark ? { ...DarkTheme, colors: { ...DarkTheme.colors, background: theme.background as string } } : { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: theme.background as string } }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenLayout={SessionScreenLayout}
        screenOptions={{
          headerShown: false,
          headerTransparent: true,
          headerShadowVisible: false,
          headerLargeTitle: false,
          headerLargeStyle: { backgroundColor: 'transparent' },
          headerBlurEffect: 'none',
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="auth-flow"
          options={{
            presentation: 'fullScreenModal',
            animation: 'fade_from_bottom',
          }}
        />
        <Stack.Screen name="auth/transfer" />
        <Stack.Screen
          name="onboarding"
          options={{
            presentation: 'fullScreenModal',
            animation: 'fade_from_bottom',
            gestureEnabled: false,
          }}
        />
        <Stack.Screen
          name="chat/[id]"
          options={{
            ...conversationHeader,
            title: '',
            presentation: 'card',
            animation: 'slide_from_right',
          }}
        />
        <Stack.Screen
          name="note/[id]"
          options={{
            headerShown: true,
            title: '',
            presentation: 'card',
            animation: 'slide_from_right',
          }}
        />
        <Stack.Screen
          name="agent/[id]"
          options={{
            ...nativeHeader,
            title: '',
            headerLargeTitle: false,
            presentation: 'card',
            animation: 'slide_from_right',
          }}
        />
        <Stack.Screen
          name="dm/[id]"
          options={{
            ...conversationHeader,
            // Blank until the conversation names itself, never the route path.
            title: '',
            presentation: 'card',
            animation: 'slide_from_right',
          }}
        />
        <Stack.Screen
          name="channel/[id]"
          options={{
            ...conversationHeader,
            // Blank until the conversation names itself, never the route path.
            title: '',
            presentation: 'card',
            animation: 'slide_from_right',
          }}
        />
        <Stack.Screen
          name="thread/[id]"
          options={{
            ...conversationHeader,
            // Blank until the conversation names itself, never the route path.
            title: '',
            presentation: 'card',
            animation: 'slide_from_right',
          }}
        />
        {[
          ['settings', 'Settings'],
          ['automations', 'Automations'],
          ['activity', 'Activity'],
        ].map(([name, title]) => (
          <Stack.Screen key={name} name={name} options={{ ...nativeHeader, title, headerLargeTitle: false }} />
        ))}
        <Stack.Screen name="tools" options={{ ...nativeHeader, title: 'Extensions', headerLargeTitle: false }} />
        <Stack.Screen name="archived" options={{ ...nativeHeader, title: 'Archived', headerLargeTitle: false }} />
        <Stack.Screen name="workspace" options={{ ...nativeHeader, title: 'Workspace', headerLargeTitle: false }} />
        <Stack.Screen name="chat/index" options={{ ...conversationHeader, title: '' }} />
        <Stack.Screen
          name="agent-create"
          options={{
            ...nativeHeader,
            title: 'New Agent',
            headerLargeTitle: false,
            headerTransparent: true,
            contentStyle: undefined,
            presentation: 'formSheet',
            sheetAllowedDetents: [1],
            sheetGrabberVisible: true,
            sheetCornerRadius: 28,
          }}
        />
        <Stack.Screen
          name="skill-edit"
          options={{
            ...nativeHeader,
            title: 'Skill',
            headerLargeTitle: false,
            headerTransparent: true,
            contentStyle: undefined,
            presentation: 'formSheet',
            sheetAllowedDetents: [1],
            sheetGrabberVisible: true,
            sheetCornerRadius: 28,
          }}
        />
        <Stack.Screen
          name="mcp-edit"
          options={{
            ...nativeHeader,
            title: 'MCP server',
            headerLargeTitle: false,
            headerTransparent: true,
            contentStyle: undefined,
            presentation: 'formSheet',
            sheetAllowedDetents: [1],
            sheetGrabberVisible: true,
            sheetCornerRadius: 28,
          }}
        />
        <Stack.Screen
          name="automation-edit"
          options={{
            ...nativeHeader,
            title: 'Automation',
            headerLargeTitle: false,
            headerTransparent: true,
            contentStyle: undefined,
            presentation: 'formSheet',
            sheetAllowedDetents: [1],
            sheetGrabberVisible: true,
            sheetCornerRadius: 28,
          }}
        />
        <Stack.Screen
          name="new-message"
          options={{
            ...nativeHeader,
            title: 'New message',
            headerLargeTitle: false,
            headerTransparent: true,
            contentStyle: undefined,
            presentation: 'formSheet',
            sheetAllowedDetents: [0.7, 1],
            sheetGrabberVisible: true,
            sheetCornerRadius: 28,
          }}
        />
        <Stack.Screen
          name="new-channel"
          options={{
            ...nativeHeader,
            title: 'New channel',
            headerLargeTitle: false,
            headerTransparent: true,
            contentStyle: undefined,
            presentation: 'formSheet',
            sheetAllowedDetents: [0.7, 1],
            sheetGrabberVisible: true,
            sheetCornerRadius: 28,
          }}
        />
        <Stack.Screen
          name="account"
          options={{
            ...nativeHeader,
            title: 'Account',
            headerLargeTitle: false,
            headerTransparent: true,
            contentStyle: undefined,
            presentation: 'formSheet',
            sheetAllowedDetents: [0.7, 1],
            sheetGrabberVisible: true,
            sheetCornerRadius: 28,
          }}
        />
        <Stack.Screen
          name="invitations/[id]"
          options={{
            ...nativeHeader,
            title: 'Join workspace',
            headerLargeTitle: false,
            presentation: 'card',
            animation: 'slide_from_right',
          }}
        />
      </Stack>
    </NavigationThemeProvider>
  )
}

export default function RootLayout(): React.ReactElement {
  const [fontsLoaded] = useFonts({
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Geist: require('@expo-google-fonts/geist/400Regular/Geist_400Regular.ttf'),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    GeistMedium: require('@expo-google-fonts/geist/500Medium/Geist_500Medium.ttf'),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    GeistSemibold: require('@expo-google-fonts/geist/600SemiBold/Geist_600SemiBold.ttf'),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    LibreBaskerville: require('../assets/fonts/libre-baskerville/static/LibreBaskerville-Regular.ttf'),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    'LibreBaskerville-Italic': require('../assets/fonts/libre-baskerville/static/LibreBaskerville-Italic.ttf'),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    'LibreBaskerville-Bold': require('../assets/fonts/libre-baskerville/static/LibreBaskerville-Bold.ttf'),
  })

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    )
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ThemeProvider>
          <ConvexAuthProvider>
            <AppSessionProvider>
              <SettingsLiveBridge />
              <WorkspaceProvider>
                <DrawerProvider>
                  <AppShell>
                    <RootLayoutNav />
                  </AppShell>
                </DrawerProvider>
              </WorkspaceProvider>
            </AppSessionProvider>
          </ConvexAuthProvider>
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  )
}
