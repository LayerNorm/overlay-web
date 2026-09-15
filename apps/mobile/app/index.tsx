import React, { useEffect } from 'react'
import { useRouter } from 'expo-router'
import { useAuth } from '../contexts/AuthContext'
import { loadMobilePreferences, type StartDestination } from '../services/mobilePreferencesService'

function destinationPath(destination: StartDestination): '/(tabs)/chat' | '/(tabs)/agents' | '/(tabs)/voice' | '/(tabs)/projects' | '/(tabs)/knowledge' {
  if (destination === 'agents') return '/(tabs)/agents'
  if (destination === 'voice') return '/(tabs)/voice'
  if (destination === 'projects') return '/(tabs)/projects'
  if (destination === 'knowledge') return '/(tabs)/knowledge'
  return '/(tabs)/chat'
}

export default function AppEntryScreen(): React.ReactElement | null {
  const router = useRouter()
  const { isAuthenticated, isLoading } = useAuth()

  useEffect(() => {
    if (isLoading) {
      return
    }

    if (!isAuthenticated) {
      router.replace('/auth-flow?mode=sign-in&force=true')
      return
    }

    void loadMobilePreferences().then((preferences) => {
      router.replace(destinationPath(preferences.startDestination))
    })
  }, [isAuthenticated, isLoading, router])

  return null
}
