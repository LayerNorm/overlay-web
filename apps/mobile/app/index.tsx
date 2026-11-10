import React, { useEffect } from 'react'
import { useRouter } from 'expo-router'
import { useAuth } from '../contexts/AuthContext'
import { loadMobilePreferences, type StartDestination } from '../services/mobilePreferencesService'
import { needsOnboarding } from '../services/onboardingService'

function destinationPath(destination: StartDestination): '/(tabs)/chat' | '/(tabs)/agents' | '/(tabs)/voice' | '/(tabs)/files' | '/(tabs)/work' {
  if (destination === 'agents') return '/(tabs)/agents'
  if (destination === 'work') return '/(tabs)/work'
  if (destination === 'files') return '/(tabs)/files'
  if (destination === 'voice') return '/(tabs)/voice'
  return '/(tabs)/chat'
}

export default function AppEntryScreen(): React.ReactElement | null {
  const router = useRouter()
  const { isAuthenticated, isLoading, user } = useAuth()

  useEffect(() => {
    if (isLoading) {
      return
    }

    if (!isAuthenticated || !user?.id) {
      router.replace('/auth-flow?mode=sign-in&force=true')
      return
    }

    // Onboarding gate (web `OnboardingProvider` parity): local flag → server
    // `hasSeenOnboarding`; unfinished flows route to /onboarding first.
    void needsOnboarding(user.id).then((needs) => {
      if (needs) {
        router.replace('/onboarding')
        return
      }
      void loadMobilePreferences().then((preferences) => {
        router.replace(destinationPath(preferences.startDestination))
      })
    })
  }, [isAuthenticated, isLoading, router, user?.id])

  return null
}
