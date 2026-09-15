import React, { useEffect } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../../hooks/useTheme'
import { loadMobilePreferences, type StartDestination } from '../../services/mobilePreferencesService'

function destinationPath(destination: StartDestination): '/(tabs)/chat' | '/(tabs)/agents' | '/(tabs)/voice' | '/(tabs)/projects' | '/(tabs)/knowledge' {
  if (destination === 'agents') return '/(tabs)/agents'
  if (destination === 'voice') return '/(tabs)/voice'
  if (destination === 'projects') return '/(tabs)/projects'
  if (destination === 'knowledge') return '/(tabs)/knowledge'
  return '/(tabs)/chat'
}

export default function IndexRedirect(): React.ReactElement {
  const router = useRouter()
  const { theme } = useTheme()

  useEffect(() => {
    void loadMobilePreferences().then((preferences) => {
      router.replace(destinationPath(preferences.startDestination))
    })
  }, [router])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.textSecondary} />
      </View>
    </SafeAreaView>
  )
}
