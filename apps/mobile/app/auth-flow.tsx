import React, { useEffect, useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as WebBrowser from 'expo-web-browser'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTheme } from '../hooks/useTheme'
import { useAuth } from '../contexts/AuthContext'
import {
  buildCustomAuthUrl,
  consumeTransferToken,
  extractTransferToken,
} from '../services/authService'
import { SignInScreen } from '../components/shell/EntryScreens'

WebBrowser.maybeCompleteAuthSession()

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
      const url = await buildCustomAuthUrl('sign-in', { forceLogin: force === 'true' })
      const result = await WebBrowser.openAuthSessionAsync(url, 'overlay://auth/transfer', {
        preferEphemeralSession: false,
      })
      if (result.type !== 'success') return
      const token = extractTransferToken(result.url)
      if (!token) throw new Error('Sign in did not complete. Please try again.')
      await completeNativeSignIn(await consumeTransferToken(token))
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
