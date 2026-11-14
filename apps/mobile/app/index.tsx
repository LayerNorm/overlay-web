import React, { useEffect } from 'react'
import { useRouter } from 'expo-router'
import { useAuth } from '../contexts/AuthContext'
import { loadMobilePreferences, type StartDestination } from '../services/mobilePreferencesService'
import { useWorkspace } from '../contexts/WorkspaceContext'

function destinationPath(
  destination: StartDestination,
): '/(tabs)/chat' | '/(tabs)/agents' | '/(tabs)/voice' | '/(tabs)/files' | '/(tabs)/work' {
  if (destination === 'agents') return '/(tabs)/agents'
  if (destination === 'work') return '/(tabs)/work'
  if (destination === 'files') return '/(tabs)/files'
  if (destination === 'voice') return '/(tabs)/voice'
  return '/(tabs)/chat'
}

export default function AppEntryScreen(): React.ReactElement | null {
  const router = useRouter()
  const { isAuthenticated, isLoading, user } = useAuth()
  const { isLoading: workspaceLoading, workspaces, error } = useWorkspace()

  useEffect(() => {
    if (isLoading) {
      return
    }

    if (!isAuthenticated || !user?.id) {
      router.replace('/auth-flow?mode=sign-in&force=true')
      return
    }

    if (workspaceLoading || error || !workspaces.length) return
    let cancelled = false
    void loadMobilePreferences().then((preferences) => {
      if (!cancelled) {
        router.replace(destinationPath(preferences.startDestination))
      }
    })
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, isLoading, router, user?.id, workspaceLoading, workspaces.length, error])

  return null
}
