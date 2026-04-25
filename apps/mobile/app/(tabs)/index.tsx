import React, { useEffect } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../../hooks/useTheme'

export default function IndexRedirect(): React.ReactElement {
  const router = useRouter()
  const { theme } = useTheme()

  useEffect(() => {
    router.replace('/(tabs)/chat')
  }, [router])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.textSecondary} />
      </View>
    </SafeAreaView>
  )
}
