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
        <Stack.Screen name="onboarding" />
        <Stack.Screen
          name="auth-flow"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom'
          }}
        />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="note/[id]"
          options={{
            presentation: 'card',
            animation: 'slide_from_right'
          }}
        />
        <Stack.Screen
          name="chat/[id]"
          options={{
            presentation: 'card',
            animation: 'slide_from_right'
          }}
        />
        <Stack.Screen
          name="file/[id]"
          options={{
            presentation: 'card',
            animation: 'slide_from_right'
          }}
        />
        <Stack.Screen
          name="project/[id]"
          options={{
            presentation: 'card',
            animation: 'slide_from_right'
          }}
        />
        <Stack.Screen
          name="more/extensions"
          options={{
            presentation: 'card',
            animation: 'slide_from_right'
          }}
        />
        <Stack.Screen
          name="more/automations"
          options={{
            presentation: 'card',
            animation: 'slide_from_right'
          }}
        />
        <Stack.Screen
          name="more/automation/[id]"
          options={{
            presentation: 'card',
            animation: 'slide_from_right'
          }}
        />
      </Stack>
    </>
  )
}

export default function RootLayout(): React.ReactElement {
  const [fontsLoaded] = useFonts({
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    'InstrumentSerif-Regular': require('../assets/fonts/InstrumentSerif-Regular.ttf'),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    'InstrumentSerif-Italic': require('../assets/fonts/InstrumentSerif-Italic.ttf')
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
      <ThemeProvider>
        <AuthProvider>
          <RootLayoutNav />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
