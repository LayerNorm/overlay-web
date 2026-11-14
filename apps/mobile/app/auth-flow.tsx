import React, { useEffect, useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTheme } from '../hooks/useTheme'
import { useAuth } from '../contexts/AuthContext'
import { signInWithNativeAuth } from '../services/nativeSignInService'
import { SignInScreen } from '../components/shell/EntryScreens'

export default function AuthFlowScreen() {
  const { theme } = useTheme()
  const { completeNativeSignIn, isAuthenticated } = useAuth()
  const { force } = useLocalSearchParams<{ force?: string }>()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (isAuthenticated) router.replace('/')
  }, [isAuthenticated, router])
  const signIn = async () => {
    setBusy(true)
    setError(null)
    try {
      const session = await signInWithNativeAuth({ forceSignIn: force === 'true' })
      if (!session) return
      await completeNativeSignIn(session)
      router.replace('/')
    } catch (next) {
      setError(next instanceof Error ? next.message : 'Unable to sign in. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <SignInScreen theme={theme} busy={busy} error={error} onSignIn={() => void signIn()} />
    </SafeAreaView>
  )
}
