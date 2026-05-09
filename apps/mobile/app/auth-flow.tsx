import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import Svg, { Path } from 'react-native-svg'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated'
import { borderRadius, fontSize } from '../constants/theme'
import { useTheme } from '../hooks/useTheme'
import { useAuth } from '../contexts/AuthContext'
import {
  buildCustomAuthUrl,
  consumeTransferToken,
  extractTransferToken,
} from '../services/authService'

WebBrowser.maybeCompleteAuthSession()

// eslint-disable-next-line @typescript-eslint/no-require-imports
const OVERLAY_LOGO = require('../assets/overlay-logo.png')
const TRANSFER_REDIRECT_URI = 'overlay://auth/transfer'

const FADE_DURATION = 400
const STAGGER_DELAY = 100

// React Native's <Image> can't rasterize SVG files, which is why the Google
// asset was rendering as a blank box. Render the official 4-color G inline
// via react-native-svg (already in the deps tree) so the icon ships with the
// JS bundle and never relies on a native loader.
function GoogleIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 48 48" accessibilityLabel="Google">
      <Path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <Path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <Path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <Path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </Svg>
  )
}

function AppleIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 814 1000" accessibilityLabel="Apple">
      <Path
        fill="#000000"
        d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8-61.8 0-105.8-57.4-155.9-125.5C72.1 791.2 0 653.3 0 521.5c0-204.9 132.9-313.4 263.5-313.4 69.5 0 127.3 45.6 171 45.6 41.7 0 106.4-48.3 183.2-48.3 29.7 0 136.1 2.8 200.4 106.5zM554.1 125.4c36.4-43.9 61.4-104.6 61.4-165.4 0-8.5-.7-17.1-2.1-25.4-58.5 2.2-127.7 39.1-169.3 88-33.4 38.5-63 104.9-63 165.9 0 9.6 1.6 19.2 2.1 22.2 3.7.7 9.6 1.1 15.5 1.1 52.5 0 118.6-35.4 155.7-86.4z"
      />
    </Svg>
  )
}

function MicrosoftIcon() {
  return (
    <View style={styles.microsoftContainer}>
      <View style={[styles.microsoftSquare, { backgroundColor: '#F25022' }]} />
      <View style={[styles.microsoftSquare, { backgroundColor: '#00A4EF' }]} />
      <View style={[styles.microsoftSquare, { backgroundColor: '#7FBA00' }]} />
      <View style={[styles.microsoftSquare, { backgroundColor: '#FFB900' }]} />
    </View>
  )
}

interface FadeInViewProps {
  children: React.ReactNode
  delay?: number
  style?: ViewStyle
}

function FadeInView({ children, delay = 0, style }: FadeInViewProps) {
  const opacity = useSharedValue(0)
  const translateY = useSharedValue(10)

  useEffect(() => {
    // reanimated shared values are designed to be modified in effects
    opacity.value = withDelay( // eslint-disable-line
      delay,
      withTiming(1, {
        duration: FADE_DURATION,
        easing: Easing.out(Easing.ease),
      })
    )
    translateY.value = withDelay( // eslint-disable-line
      delay,
      withTiming(0, {
        duration: FADE_DURATION,
        easing: Easing.out(Easing.ease),
      })
    )
  }, [delay, opacity, translateY])

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }))

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
}

export default function AuthFlowScreen(): React.ReactElement {
  const router = useRouter()
  const params = useLocalSearchParams<{ force?: string }>()
  const { theme } = useTheme()
  const { isAuthenticated, completeNativeSignIn } = useAuth()
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [browserError, setBrowserError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const forceLogin = params.force === 'true'

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
    <SafeAreaView style={[styles.container, { backgroundColor: '#0a0a0a' }]} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.content}>
        <FadeInView delay={STAGGER_DELAY * 0} style={styles.brandBlock}>
          <Image source={OVERLAY_LOGO} resizeMode="contain" style={styles.logo} accessibilityLabel="Overlay logo" />
          <Text style={[styles.title, { color: '#ffffff' }]}>overlay</Text>
        </FadeInView>

        <View style={styles.buttonStack}>
          <FadeInView delay={STAGGER_DELAY * 1}>
            <TouchableOpacity
              activeOpacity={0.86}
              disabled={isSigningIn}
              onPress={() => {
                void startAuth()
              }}
              style={styles.providerButton}
            >
              {isSigningIn ? (
                <ActivityIndicator color="#000000" />
              ) : (
                <>
                  <GoogleIcon />
                  <Text style={[styles.providerButtonText, { color: '#000000' }]}>Continue with Google</Text>
                </>
              )}
            </TouchableOpacity>
          </FadeInView>

          <FadeInView delay={STAGGER_DELAY * 2}>
            <TouchableOpacity
              activeOpacity={0.86}
              disabled={isSigningIn}
              onPress={() => {
                void startAuth()
              }}
              style={styles.providerButton}
            >
              {isSigningIn ? (
                <ActivityIndicator color="#000000" />
              ) : (
                <>
                  <AppleIcon />
                  <Text style={[styles.providerButtonText, { color: '#000000' }]}>Continue with Apple</Text>
                </>
              )}
            </TouchableOpacity>
          </FadeInView>

          <FadeInView delay={STAGGER_DELAY * 3}>
            <TouchableOpacity
              activeOpacity={0.86}
              disabled={isSigningIn}
              onPress={() => {
                void startAuth()
              }}
              style={styles.providerButton}
            >
              {isSigningIn ? (
                <ActivityIndicator color="#000000" />
              ) : (
                <>
                  <MicrosoftIcon />
                  <Text style={[styles.providerButtonText, { color: '#000000' }]}>Continue with Microsoft</Text>
                </>
              )}
            </TouchableOpacity>
          </FadeInView>

          <FadeInView delay={STAGGER_DELAY * 4} style={styles.dividerContainer}>
            <View style={[styles.dividerLine, { backgroundColor: theme.border }]} />
            <Text style={[styles.dividerText, { color: theme.textSecondary }]}>or</Text>
            <View style={[styles.dividerLine, { backgroundColor: theme.border }]} />
          </FadeInView>

          <FadeInView delay={STAGGER_DELAY * 5}>
            <View style={styles.emailRow}>
              <TextInput
                style={[styles.emailInput, { 
                  backgroundColor: theme.surfaceElevated,
                  borderColor: theme.border,
                  color: theme.text,
                }]}
                placeholder="Enter your email"
                placeholderTextColor={theme.textSecondary}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                editable={!isSigningIn}
              />
              <TouchableOpacity
                activeOpacity={0.86}
                disabled={isSigningIn}
                onPress={() => {
                  void startAuth()
                }}
                style={[styles.continueButton, { 
                  backgroundColor: theme.surfaceSubtle,
                  borderColor: theme.border,
                }]}
              >
                <Text style={[styles.continueButtonText, { color: theme.text }]}>Continue</Text>
              </TouchableOpacity>
            </View>
          </FadeInView>
        </View>

        {browserError ? (
          <FadeInView delay={STAGGER_DELAY * 6}>
            <Text style={[styles.errorText, { color: '#EF4444' }]}>{browserError}</Text>
          </FadeInView>
        ) : null}

        <FadeInView delay={STAGGER_DELAY * 7} style={styles.footer}>
          <TouchableOpacity onPress={() => void Linking.openURL('https://www.getoverlay.io/privacy')}>
            <Text style={[styles.footerLink, { color: theme.textSecondary }]}>Privacy policy</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => void Linking.openURL('https://www.getoverlay.io/terms')}>
            <Text style={[styles.footerLink, { color: theme.textSecondary }]}>Terms of service</Text>
          </TouchableOpacity>
        </FadeInView>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  brandBlock: {
    alignItems: 'center',
    marginTop: 100,
    gap: 12,
  },
  logo: {
    width: 64,
    height: 64,
  },
  title: {
    fontSize: 42,
    lineHeight: 48,
    fontWeight: '400',
    fontFamily: 'LibreBaskerville',
    color: '#ffffff',
  },
  buttonStack: {
    gap: 10,
    marginTop: 48,
  },
  providerButton: {
    height: 50,
    borderRadius: borderRadius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#ffffff',
  },
  providerButtonText: {
    fontSize: 17,
    fontWeight: '600',
  },
  appleIcon: {
    fontSize: 20,
    fontWeight: '400',
    marginTop: -2,
  },
  googleIconImage: {
    width: 18,
    height: 18,
  },
  microsoftContainer: {
    width: 18,
    height: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 1,
  },
  microsoftSquare: {
    width: 8,
    height: 8,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: 14,
    fontWeight: '400',
  },
  emailRow: {
    flexDirection: 'row',
    gap: 8,
  },
  emailInput: {
    flex: 1,
    height: 46,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  continueButton: {
    height: 46,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  continueButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  errorText: {
    fontSize: fontSize.sm,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 16,
  },
  footer: {
    marginTop: 'auto',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    paddingBottom: 8,
  },
  footerLink: {
    fontSize: fontSize.sm,
    fontWeight: '400',
  },
})
