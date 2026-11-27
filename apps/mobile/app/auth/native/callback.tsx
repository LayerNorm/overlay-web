import React, { useEffect } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '../../../contexts/AuthContext'
import { getAccountDeletionState, isAccountDeletionCallback } from '../../../services/accountDeletionService'
import { useTheme } from '../../../hooks/useTheme'
import { Button } from '../../../components/shell/primitives'

export default function NativeAuthCallbackScreen(): React.ReactElement {
  const router = useRouter()
  const { state } = useLocalSearchParams<{ state?: string }>()
  const { theme } = useTheme()
  const { isAuthenticated, isLoading, authError } = useAuth()
  const failed = !isLoading && (!isAuthenticated || !!authError)

  useEffect(() => {
    if (!isLoading && isAuthenticated && !authError) {
      router.replace(getAccountDeletionState().busy || isAccountDeletionCallback(`overlay://auth/callback?state=${encodeURIComponent(state ?? '')}`) ? '/settings?section=account' : '/chat')
    }
  }, [authError, isAuthenticated, isLoading, router, state])

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.card, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
        {!failed && <ActivityIndicator color={theme.textSecondary} />}
        <Text style={[styles.title, { color: theme.text }]}>{failed ? 'Sign-in did not finish' : 'Finishing sign-in'}</Text>
        <Text style={[styles.description, { color: authError ? '#EF4444' : theme.textSecondary }]}>
          {authError || (failed ? 'Start sign-in from Overlay again.' : 'Returning to Overlay...')}
        </Text>
        {failed && <Button theme={theme} onPress={() => router.replace('/auth-flow')}>Try again</Button>}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 24,
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 28,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
    fontFamily: 'LibreBaskerville',
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
})
