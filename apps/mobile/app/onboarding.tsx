import React, { useCallback } from 'react'
import { useRouter } from 'expo-router'
import { OnboardingFlow } from '../components/onboarding/OnboardingFlow'
import { useAuth } from '../contexts/AuthContext'
import { finishOnboarding } from '../services/onboardingService'
import { loadMobilePreferences, type StartDestination } from '../services/mobilePreferencesService'

function destinationPath(destination: StartDestination): string {
  if (destination === 'agents') return '/(tabs)/agents'
  if (destination === 'voice') return '/(tabs)/voice'
  if (destination === 'projects') return '/(tabs)/projects'
  if (destination === 'knowledge') return '/(tabs)/knowledge'
  return '/(tabs)/chat'
}

export default function OnboardingScreen(): React.ReactElement {
  const router = useRouter()
  const { user } = useAuth()

  const handleFinish = useCallback(() => {
    const userId = user?.id
    if (userId) void finishOnboarding(userId)
    void loadMobilePreferences().then((preferences) => {
      router.replace(destinationPath(preferences.startDestination) as never)
    })
  }, [router, user?.id])

  return <OnboardingFlow onFinish={handleFinish} />
}
