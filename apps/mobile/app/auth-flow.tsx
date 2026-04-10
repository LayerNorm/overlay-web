import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { borderRadius, fontSize, spacing } from '../constants/theme'
import { useTheme } from '../hooks/useTheme'
import { useAuth } from '../contexts/AuthContext'
import { buildCustomAuthUrl } from '../services/authService'

export default function AuthFlowScreen(): React.ReactElement {
  const router = useRouter()
  const params = useLocalSearchParams<{ mode?: string; force?: string; startAtAuth?: string }>()
  const { theme } = useTheme()
  const { isAuthenticated } = useAuth()
  const [isOpeningBrowser, setIsOpeningBrowser] = useState(false)
  const [browserError, setBrowserError] = useState<string | null>(null)
  const hasOpenedRef = useRef(false)

  const mode = params.mode === 'sign-up' ? 'sign-up' : 'sign-in'
  const forceLogin = params.force === 'true'
  const startAtAuth = params.startAtAuth === 'true'

  const authUrl = useMemo(
    () => buildCustomAuthUrl(mode, { forceLogin }),
    [forceLogin, mode]
  )

  const handleClose = useCallback(() => {
    if (router.canGoBack()) {
      router.back()
      return
    }

    router.replace(startAtAuth ? '/onboarding?startAtAuth=true' : '/(tabs)')
  }, [router, startAtAuth])

  const openInBrowser = useCallback(async () => {
    setIsOpeningBrowser(true)
    setBrowserError(null)

    try {
      await Linking.openURL(authUrl)
    } catch (error) {
      setBrowserError(error instanceof Error ? error.message : 'Unable to open browser')
    } finally {
      setIsOpeningBrowser(false)
    }
  }, [authUrl])

  useEffect(() => {
    if (!isAuthenticated) {
      return
    }

    handleClose()
  }, [handleClose, isAuthenticated])

  useEffect(() => {
    if (hasOpenedRef.current) {
      return
    }

    hasOpenedRef.current = true
    void openInBrowser()
  }, [openInBrowser])

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <View style={styles.headerCopy}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>
            {mode === 'sign-up' ? 'Create your account' : 'Sign in to Overlay'}
          </Text>
          <Text style={[styles.headerDescription, { color: theme.textSecondary }]}>
            This is the same hosted auth flow used on desktop.
          </Text>
        </View>

        <TouchableOpacity
          onPress={handleClose}
          activeOpacity={0.82}
          style={[styles.closeButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
        >
          <Feather name="x" size={18} color={theme.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={[styles.iconWrap, { backgroundColor: theme.background, borderColor: theme.border }]}>
            <Feather name="external-link" size={22} color={theme.text} />
          </View>

          <Text style={[styles.cardTitle, { color: theme.text }]}>
            Continue in your browser
          </Text>
          <Text style={[styles.cardDescription, { color: theme.textSecondary }]}>
            Google sign-in is not allowed inside embedded web views. Overlay now opens the hosted auth flow in Safari and returns here automatically after sign-in.
          </Text>

          <TouchableOpacity
            onPress={() => {
              void openInBrowser()
            }}
            activeOpacity={0.82}
            style={[styles.primaryButton, { backgroundColor: theme.buttonBg }]}
          >
            {isOpeningBrowser ? (
              <ActivityIndicator color={theme.surface} />
            ) : (
              <>
                <Text style={[styles.primaryButtonText, { color: theme.surface }]}>
                  Open Safari
                </Text>
                <Feather name="arrow-up-right" size={16} color={theme.surface} />
              </>
            )}
          </TouchableOpacity>

          <View style={[styles.infoPanel, { backgroundColor: theme.background, borderColor: theme.border }]}>
            <Text style={[styles.infoTitle, { color: theme.text }]}>What to expect</Text>
            <Text style={[styles.infoText, { color: theme.textSecondary }]}>
              Sign in in Safari, then the auth site will deep link back into the app.
            </Text>
          </View>

          {browserError ? (
            <Text style={styles.errorText}>{browserError}</Text>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1
  },
  headerCopy: {
    flex: 1,
    gap: 4
  },
  headerTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700'
  },
  headerDescription: {
    fontSize: fontSize.sm,
    lineHeight: 19
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl
  },
  card: {
    borderWidth: 1,
    borderRadius: 28,
    padding: spacing.xl,
    gap: spacing.lg
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  cardTitle: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '700'
  },
  cardDescription: {
    fontSize: fontSize.md,
    lineHeight: 24
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm
  },
  primaryButtonText: {
    fontSize: fontSize.md,
    fontWeight: '700'
  },
  infoPanel: {
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: 4
  },
  infoTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700'
  },
  infoText: {
    fontSize: fontSize.sm,
    lineHeight: 20
  },
  errorText: {
    color: '#EF4444',
    fontSize: fontSize.sm,
    lineHeight: 20
  }
})
