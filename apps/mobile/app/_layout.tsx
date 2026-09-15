import React, { useEffect } from 'react'
import { View, ActivityIndicator, Linking } from 'react-native'
import { Stack, router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useFonts } from 'expo-font'
import { ThemeProvider, useTheme } from '../hooks/useTheme'
import { AuthProvider } from '../contexts/AuthContext'
import { AppSessionProvider } from '../contexts/AppSessionContext'
import { WorkspaceProvider } from '../contexts/WorkspaceContext'

function handleDeepLink(url: string | null | undefined): void {
  if (!url) return
  // Dictate URLs from the keyboard land users on the Voice page so they can
  // toggle background recording on. We pass autoEnable=1 so the page flips
  // the switch automatically.
  if (url.startsWith('overlay://dictate')) {
    router.push('/(tabs)/voice?autoEnable=1')
  }
}

function useDictateDeepLink(): void {
  useEffect(() => {
    void Linking.getInitialURL().then(handleDeepLink)
    const sub = Linking.addEventListener('url', (event) => handleDeepLink(event.url))
    return () => sub.remove()
  }, [])
}

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

function RootLayoutNav(): React.ReactElement {
  const { isDark } = useTheme()
  useDictateDeepLink()
  useVoiceAuthSync()

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
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
          name="chat/[id]"
          options={{
            headerShown: true,
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
            headerShown: false,
            presentation: 'card',
            animation: 'slide_from_right',
          }}
        />
        <Stack.Screen
          name="search"
          options={{
            presentation: 'card',
            animation: 'slide_from_right',
          }}
        />
      </Stack>
    </>
  )
}

export default function RootLayout(): React.ReactElement {
  const [fontsLoaded] = useFonts({
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
          <AppSessionProvider>
            <WorkspaceProvider>
              <RootLayoutNav />
            </WorkspaceProvider>
          </AppSessionProvider>
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  )
}
