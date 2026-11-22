import React, { useEffect, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Linking,
  View,
} from 'react-native'
import { ExternalLink, WifiOff } from 'lucide-react-native'
import type { Theme } from '../../constants/theme'
import { BrandWordmark, OverlayMark } from './Brand'
import { Button, T } from './primitives'
import { CreatureField } from '../creatures/CreatureField'
import { PillButton } from '../creatures/PillButton'

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
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <CreatureField />
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 18, paddingHorizontal: 32 }}>
        <BrandWordmark size={44} color={theme.foreground} />
        <T style={{ color: theme.muted, fontSize: 18, textAlign: 'center' }}>Your AI Chief of Staff.</T>
      </View>
      <View style={{ paddingHorizontal: 24, paddingBottom: 12, gap: 14 }}>
        <PillButton
          label={busy ? 'Opening sign in…' : 'Continue'}
          busy={busy}
          onPress={onSignIn}
          accessibilityLabel="Continue to sign in"
        />
        <T style={{ color: theme.muted, fontSize: 12, textAlign: 'center', lineHeight: 18 }}>
          Sign in securely with email, Google, Apple or SSO.
        </T>
        {error ? (
          <T accessibilityRole="alert" style={{ color: theme.foreground, fontSize: 13, textAlign: 'center' }}>
            {error}
          </T>
        ) : null}
      </View>
    </View>
  )
}

export function WorkspaceGate({ theme, onSignOut, onAccount }: { theme: Theme; onSignOut: () => void; onAccount?: () => void }) {
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
      {onAccount ? <Button theme={theme} onPress={onAccount}>Account settings</Button> : null}
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
      <WifiOff size={13} color={theme.muted} style={{ flexShrink: 0 }} />
      <T style={{ color: theme.muted, fontSize: 12, lineHeight: 16, flex: 1, flexShrink: 1 }}>
        Offline. Changes sync when you reconnect.
      </T>
    </View>
  )
}
