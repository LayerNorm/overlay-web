import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { borderRadius, fontSize } from '../constants/theme'
import { useTheme } from '../hooks/useTheme'
import { useAuth } from '../contexts/AuthContext'
import {
  buildCustomAuthUrl,
  consumeTransferToken,
  extractTransferToken,
} from '../services/authService'
import { GlassSurface } from '../components/ui/GlassSurface'

WebBrowser.maybeCompleteAuthSession()

const OVERLAY_LOGO = require('../../overlay-landing/overlay-logo.png')
const TRANSFER_REDIRECT_URI = 'overlay://auth/transfer'

export default function AuthFlowScreen(): React.ReactElement {
  const router = useRouter()
  const params = useLocalSearchParams<{ force?: string }>()
  const { theme } = useTheme()
  const { isAuthenticated, completeNativeSignIn } = useAuth()
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [browserError, setBrowserError] = useState<string | null>(null)
  const forceLogin = params.force === 'true'

  const handleClose = useCallback(() => {
    if (router.canGoBack()) {
      router.back()
      return
    }

    router.replace('/(tabs)/chat')
  }, [router])

  const startAuth = useCallback(
    async () => {
      setIsSigningIn(true)
      setBrowserError(null)

      try {
        const authUrl = await buildCustomAuthUrl('sign-in', { forceLogin })
        const result = await WebBrowser.openAuthSessionAsync(
          authUrl,
          TRANSFER_REDIRECT_URI,
          {
            preferEphemeralSession: false,
          },
        )

        if (result.type !== 'success') {
          if (result.type === 'cancel') {
            return
          }
          throw new Error('Authentication was not completed.')
        }

        const token = extractTransferToken(result.url)
        if (!token) {
          throw new Error('Authentication returned an unexpected callback. Start sign-in again.')
        }

        const session = await consumeTransferToken(token)
        await completeNativeSignIn(session)
        router.replace('/(tabs)/chat')
      } catch (error) {
        setBrowserError(error instanceof Error ? error.message : 'Unable to sign in')
      } finally {
        setIsSigningIn(false)
      }
    },
    [completeNativeSignIn, forceLogin, router],
  )

  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/(tabs)/chat')
    }
  }, [isAuthenticated, router])

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <GlassSurface style={[styles.panel, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
        <TouchableOpacity
          onPress={handleClose}
          activeOpacity={0.82}
          style={[styles.closeButton, { backgroundColor: theme.surfaceSubtle }]}
        >
          <Feather name="x" size={28} color={theme.text} />
        </TouchableOpacity>

        <View style={styles.brandBlock}>
          <Image source={OVERLAY_LOGO} resizeMode="contain" style={styles.logo} />
          <Text style={[styles.title, { color: theme.text }]}>Overlay</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Sign in or create an account</Text>
        </View>

        <View style={styles.providerStack}>
          <TouchableOpacity
            activeOpacity={0.86}
            disabled={isSigningIn}
            onPress={() => {
              void startAuth()
            }}
            style={[
              styles.providerButton,
              {
                backgroundColor: theme.foreground,
              },
            ]}
          >
            {isSigningIn ? (
              <ActivityIndicator color={theme.background} />
            ) : (
              <>
                <Feather name="log-in" size={22} color={theme.background} />
                <Text style={[styles.providerText, { color: theme.background }]}>
                  Continue to sign in
                </Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={[styles.providerHint, { color: theme.textSecondary }]}>
            Choose Google, Apple, Microsoft, or email on the secure Overlay sign-in page.
          </Text>
        </View>

        {browserError ? <Text style={[styles.errorText, { color: '#EF4444' }]}>{browserError}</Text> : null}

        <View style={styles.footer}>
          <TouchableOpacity onPress={() => void Linking.openURL('https://www.getoverlay.io/privacy')}>
            <Text style={[styles.footerLink, { color: theme.textSecondary }]}>Privacy policy</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => void Linking.openURL('https://www.getoverlay.io/terms')}>
            <Text style={[styles.footerLink, { color: theme.textSecondary }]}>Terms of service</Text>
          </TouchableOpacity>
        </View>
      </GlassSurface>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  panel: {
    minHeight: '74%',
    borderWidth: 1,
    borderRadius: 34,
    paddingHorizontal: 24,
    paddingTop: 34,
    paddingBottom: 24,
    gap: 26,
  },
  closeButton: {
    position: 'absolute',
    top: 20,
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  brandBlock: {
    alignItems: 'center',
    gap: 8,
    paddingTop: 86,
  },
  logo: {
    width: 72,
    height: 72,
  },
  title: {
    fontSize: 58,
    lineHeight: 64,
    fontWeight: '400',
    fontFamily: 'LibreBaskerville',
  },
  subtitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  providerStack: {
    gap: 14,
    marginTop: 22,
  },
  providerButton: {
    minHeight: 58,
    borderRadius: borderRadius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  providerText: {
    fontSize: 20,
    fontWeight: '700',
  },
  providerHint: {
    fontSize: fontSize.sm,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  errorText: {
    fontSize: fontSize.sm,
    lineHeight: 20,
    textAlign: 'center',
  },
  footer: {
    marginTop: 'auto',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerLink: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
})
