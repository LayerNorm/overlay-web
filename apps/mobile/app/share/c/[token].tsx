import React, { useEffect } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { AUTH_BASE_URL } from '../../../services/appConfig'
import { useTheme } from '../../../hooks/useTheme'

/**
 * Deep-link target for shared conversations (`overlay://share/c/<token>` and
 * universal `/share/c/<token>` links once the AASA file ships — Phase 10).
 *
 * The public shared-chat view is server-rendered only — there is no public
 * read API for native rendering yet, so the token opens the read-only page in
 * the in-app browser, then returns to chat.
 */
export default function SharedChatDeepLink(): React.ReactElement {
  const { theme } = useTheme()
  const router = useRouter()
  const { token } = useLocalSearchParams<{ token?: string }>()

  useEffect(() => {
    if (!token || typeof token !== 'string') {
      router.replace('/chat')
      return
    }
    const url = `${AUTH_BASE_URL}/share/c/${token}`
    void WebBrowser.openBrowserAsync(url).finally(() => {
      if (router.canGoBack()) {
        router.back()
      } else {
        router.replace('/chat')
      }
    })
  }, [token, router])

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ActivityIndicator color={theme.textSecondary} size="large" />
      <Text style={[styles.label, { color: theme.textSecondary }]}>Opening shared chat…</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  label: { fontSize: 14 },
})
