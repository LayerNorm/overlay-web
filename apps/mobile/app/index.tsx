import React, { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../hooks/useTheme'
import { getOnboardingState } from '../services/onboardingStorage'
import { useAuth } from '../contexts/AuthContext'

export default function AppEntryScreen(): React.ReactElement {
  const router = useRouter()
  const { theme } = useTheme()
  const { isLoading: authLoading, isAuthenticated } = useAuth()
  const [isResolving, setIsResolving] = useState(true)

  useEffect(() => {
    let isMounted = true

    async function resolveRoute(): Promise<void> {
      if (authLoading) {
        return
      }

      const onboardingState = await getOnboardingState()
      if (!isMounted) return

      if (!onboardingState.completed) {
        router.replace('/onboarding')
      } else if (isAuthenticated) {
        router.replace('/(tabs)')
      } else {
        router.replace('/onboarding?startAtAuth=true')
      }

      setIsResolving(false)
    }

    resolveRoute()

    return () => {
      isMounted = false
    }
  }, [authLoading, isAuthenticated, router])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        {isResolving && <ActivityIndicator size="large" color={theme.textSecondary} />}
      </View>
    </SafeAreaView>
  )
}
