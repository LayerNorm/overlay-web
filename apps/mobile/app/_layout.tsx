import React from 'react'
import { View, ActivityIndicator } from 'react-native'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useFonts } from 'expo-font'
import { ThemeProvider, useTheme } from '../hooks/useTheme'
import { AuthProvider } from '../contexts/AuthContext'

function RootLayoutNav(): React.ReactElement {
  const { isDark } = useTheme()

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen
          name="auth-flow"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom'
          }}
        />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="chat/[id]"
          options={{
            presentation: 'card',
            animation: 'slide_from_right'
          }}
        />
        <Stack.Screen name="auth/transfer" />
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
          <RootLayoutNav />
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  )
}
