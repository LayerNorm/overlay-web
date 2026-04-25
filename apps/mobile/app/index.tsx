import React, { useEffect } from 'react'
import { useRouter } from 'expo-router'
import { useAuth } from '../contexts/AuthContext'

export default function AppEntryScreen(): React.ReactElement | null {
  const router = useRouter()
  const { isAuthenticated, isLoading } = useAuth()

  useEffect(() => {
    if (isLoading) {
      return
    }

    router.replace(isAuthenticated ? '/(tabs)/chat' : '/auth-flow?mode=sign-in&force=true')
  }, [isAuthenticated, isLoading, router])

  return null
}
