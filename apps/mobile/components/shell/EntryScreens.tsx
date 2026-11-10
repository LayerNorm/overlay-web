import React, { useEffect, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Linking,
  ScrollView,
  View,
} from 'react-native'
import { ExternalLink, WifiOff } from 'lucide-react-native'
import type { Theme } from '../../constants/theme'
import { BrandWordmark, OverlayMark } from './Brand'
import { Button, T } from './primitives'

export function BootScreen({ theme, animate = true }: { theme: Theme; animate?: boolean }) {
  const [brand] = useState(() => new Animated.Value(animate ? 0 : 1))
  const [tagline] = useState(() => new Animated.Value(animate ? 0 : 1))
  const [opening] = useState(() => new Animated.Value(animate ? 0 : 1))
  useEffect(() => {
    if (!animate) return
    let active = true
    let animation: Animated.CompositeAnimation | undefined
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!active) return
      if (reduced) {
        brand.setValue(1)
        tagline.setValue(1)
        opening.setValue(1)
        return
      }
      animation = Animated.parallel([
        Animated.timing(brand, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.sequence([
          Animated.delay(900),
          Animated.timing(tagline, { toValue: 1, duration: 700, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.delay(1500),
          Animated.timing(opening, { toValue: 1, duration: 700, useNativeDriver: true }),
        ]),
      ])
      animation.start()
    })
    return () => {
      active = false
      animation?.stop()
    }
  }, [animate, brand, tagline, opening])
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.sidebarSurface,
        justifyContent: 'center',
        alignItems: 'center',
        paddingBottom: 100,
        gap: 24,
      }}
    >
      <Animated.View style={{ opacity: brand }}>
        <BrandWordmark color={theme.foreground} size={40} />
      </Animated.View>
      <Animated.View style={{ opacity: tagline }}>
        <T style={{ color: theme.muted }}>Your AI Chief of Staff.</T>
      </Animated.View>
      <Animated.View
        style={{
          opacity: opening,
          marginTop: 20,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <ActivityIndicator size="small" color={theme.muted} />
        <T style={{ color: theme.muted, fontSize: 12 }}>Opening Workspace…</T>
      </Animated.View>
    </View>
  )
}

export function SignInScreen({
  theme,
  busy,
  error,
  onSignIn,
}: {
  theme: Theme
  busy?: boolean
  error?: string | null
  onSignIn: () => void
}) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.sidebarSurface }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 28, gap: 24 }}
      keyboardShouldPersistTaps="handled"
    >
      <BrandWordmark size={32} color={theme.foreground} />
      <View style={{ gap: 8 }}>
        <T style={{ color: theme.foreground, fontSize: 24, letterSpacing: -0.7 }}>Welcome back</T>
        <T style={{ color: theme.muted }}>Sign in to your workspace.</T>
      </View>
      <View style={{ gap: 16 }}>
        <Button theme={theme} secondary disabled={busy} onPress={onSignIn}>
          {busy ? 'Opening sign in…' : 'Continue to sign in'}
        </Button>
        <T style={{ color: theme.muted, fontSize: 12, textAlign: 'center', lineHeight: 20 }}>
          Continue securely in your browser with email, Google, Apple or SSO.
        </T>
      </View>
      {error ? (
        <T accessibilityRole="alert" style={{ color: theme.foreground, fontSize: 13 }}>
          {error}
        </T>
      ) : null}
    </ScrollView>
  )
}

export function WorkspaceGate({ theme, onSignOut }: { theme: Theme; onSignOut: () => void }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.sidebarSurface,
        justifyContent: 'center',
        padding: 28,
        gap: 24,
      }}
    >
      <OverlayMark size={36} color={theme.foreground} />
      <T style={{ color: theme.foreground, fontSize: 24, lineHeight: 30, letterSpacing: -0.7 }}>
        Bring your workspace{'\n'}with you.
      </T>
      <T style={{ color: theme.muted, lineHeight: 25 }}>
        Set up your workspace on getoverlay.io, then come back and sign in.
      </T>
      <Button
        theme={theme}
        secondary
        icon={ExternalLink}
        onPress={() => void Linking.openURL('https://getoverlay.io')}
      >
        Open getoverlay.io
      </Button>
      <Button theme={theme} onPress={onSignOut}>
        Use another account
      </Button>
    </View>
  )
}

export function OfflineBanner({ theme }: { theme: Theme }) {
  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: theme.surfaceSubtle,
        padding: 9,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <WifiOff size={13} color={theme.muted} />
      <T style={{ color: theme.muted, fontSize: 12, lineHeight: 16 }}>
        You’re offline. Changes will sync when connected.
      </T>
    </View>
  )
}
