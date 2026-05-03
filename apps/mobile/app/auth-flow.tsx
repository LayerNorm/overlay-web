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
import { Svg, Path, G, Defs, LinearGradient, Stop, RadialGradient, ClipPath } from 'react-native-svg'
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
// eslint-disable-next-line @typescript-eslint/no-require-imports
const GOOGLE_ICON = require('../assets/google.svg')
const TRANSFER_REDIRECT_URI = 'overlay://auth/transfer'

const FADE_DURATION = 400
const STAGGER_DELAY = 100

function GoogleIcon() {
  return (
    <Image source={GOOGLE_ICON} style={styles.googleIconImage} resizeMode="contain" accessibilityLabel="Google" />
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
                  <Text style={[styles.appleIcon, { color: '#000000' }]}></Text>
                  <Text style={[styles.providerButtonText, { color: '#000000' }]}>Continue with Apple</Text>
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
                  <GoogleIcon />
                  <Text style={[styles.providerButtonText, { color: '#000000' }]}>Continue with Google</Text>
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
