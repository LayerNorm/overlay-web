import React, { useEffect, useMemo } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../../hooks/useTheme'
import { useAuth } from '../../contexts/AuthContext'
import { Button } from '../../components/shell/primitives'

export default function AuthTransferScreen(): React.ReactElement {
  const router = useRouter()
  const { theme } = useTheme()
  const { isAuthenticated, isLoading, authError } = useAuth()
  const failed = !isLoading && (!isAuthenticated || !!authError)

  const statusCopy = useMemo(() => {
    if (authError) {
      return authError
    }

    if (isAuthenticated) {
      return 'Signed in. Returning to Overlay…'
    }

    return 'Completing sign-in…'
  }, [authError, isAuthenticated])

  useEffect(() => {
    let cancelled = false

    async function resolve(): Promise<void> {
      if (isLoading) {
        return
      }

      if (authError) {
        return
      }

      if (!isAuthenticated) {
        return
      }

      if (!cancelled) {
        router.replace('/(tabs)/chat')
      }
    }

    void resolve()

    return () => {
      cancelled = true
    }
  }, [authError, isAuthenticated, isLoading, router])

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.card, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
        {!failed && <ActivityIndicator color={theme.textSecondary} />}
        <Text style={[styles.title, { color: theme.text }]}>Finishing sign-in</Text>
        <Text style={[styles.description, { color: authError ? '#EF4444' : theme.textSecondary }]}>
          {statusCopy}
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
    justifyContent: 'center',
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
