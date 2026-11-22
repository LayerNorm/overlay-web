import React, { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { useTheme } from '../../hooks/useTheme'
import { useAgentEyes } from '../../hooks/useAgentEyes'
import { requestNotificationPermission } from '../../services/notificationsService'
import { OverlayMark } from '../shell/Brand'
import { AgentAvatar } from '../shell/AgentAvatar'
import { PillButton } from '../creatures/PillButton'

/**
 * First-run onboarding: one idea per page with a creature illustration, then
 * a notification permission ask. The caller records completion
 * (`finishOnboarding`) and opens the default Overlay chat.
 */

type Page = 'meet' | 'computer' | 'handoff' | 'notifications'
const PAGES: Page[] = ['meet', 'computer', 'handoff', 'notifications']

const TITLES: Record<Page, string> = {
  meet: 'Meet Overlay',
  computer: 'Agents work on their own computer',
  handoff: 'Delegate work, now or on a schedule',
  notifications: 'Turn on notifications',
}

export function OnboardingFlow({ onFinish }: { onFinish: () => void }): React.ReactElement {
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()
  const [index, setIndex] = useState(0)
  const [asking, setAsking] = useState(false)
  const page = PAGES[index]
  const next = () => setIndex((value) => Math.min(value + 1, PAGES.length - 1))

  const turnOnNotifications = async () => {
    setAsking(true)
    try {
      await requestNotificationPermission()
    } catch {
      // Permission is optional; onboarding always continues.
    } finally {
      setAsking(false)
      onFinish()
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: insets.bottom + 8 }}>
      <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 }}>
        {index > 0 ? (
          <CircleButton symbol="chevron.left" label="Back" onPress={() => setIndex((value) => value - 1)} />
        ) : (
          <View style={{ width: 44 }} />
        )}
        {page !== 'notifications' ? (
          <Pressable accessibilityRole="button" onPress={onFinish} hitSlop={12}>
            <Text style={{ fontFamily: 'GeistMedium', fontSize: 16, color: theme.muted }}>Skip</Text>
          </Pressable>
        ) : null}
      </View>

      <Animated.View key={page} entering={FadeIn.duration(260)} style={{ flex: 1 }}>
        <Animated.Text
          entering={FadeInDown.duration(380)}
          accessibilityRole="header"
          style={{
            marginTop: 36,
            paddingHorizontal: 28,
            textAlign: 'center',
            fontFamily: 'GeistMedium',
            fontSize: 32,
            lineHeight: 38,
            letterSpacing: -0.8,
            color: theme.foreground,
          }}
        >
          {TITLES[page]}
        </Animated.Text>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          {page === 'meet' ? <MeetIllustration /> : null}
          {page === 'computer' ? <ComputerIllustration /> : null}
          {page === 'handoff' ? <HandoffIllustration /> : null}
          {page === 'notifications' ? <NotificationsIllustration /> : null}
        </View>
      </Animated.View>

      <View style={{ paddingHorizontal: 24, gap: 6 }}>
        {page === 'notifications' ? (
          <>
            <PillButton label="Turn on" busy={asking} onPress={() => void turnOnNotifications()} />
            <PillButton label="Not now" variant="plain" onPress={onFinish} />
          </>
        ) : (
          <PillButton label="Next" onPress={next} />
        )}
      </View>
    </View>
  )
}

function CircleButton({ symbol, label, onPress }: { symbol: string; label: string; onPress: () => void }) {
  const { theme } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? theme.surfaceMuted : theme.surfaceSubtle,
      })}
    >
      <Image source={`sf:${symbol}`} style={{ width: 16, height: 16 }} tintColor={theme.foreground as string} />
    </Pressable>
  )
}

const PROMPT = 'Hand any task to your agents'

/** The Overlay mark looking around, above a composer typing a first task. */
function MeetIllustration() {
  const { theme } = useTheme()
  const eyes = useAgentEyes(true)
  const [typed, setTyped] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTyped((value) => (value >= PROMPT.length ? value : value + 1)), 55)
    return () => clearInterval(timer)
  }, [])
  return (
    <View style={{ alignItems: 'center', gap: 56, width: '100%' }}>
      <OverlayMark size={150} color={theme.foreground} eyeX={eyes.x} eyeY={eyes.y} />
      <View
        style={{
          width: '100%',
          height: 56,
          borderRadius: 28,
          borderCurve: 'continuous',
          borderWidth: 0.5,
          borderColor: theme.border,
          backgroundColor: theme.surfaceSubtle,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 8,
          gap: 10,
        }}
      >
        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceMuted }}>
          <Image source="sf:plus" style={{ width: 15, height: 15 }} tintColor={theme.foreground as string} />
        </View>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: 'Geist', fontSize: 16, color: theme.foreground }}>
          {PROMPT.slice(0, typed)}
          <Text style={{ color: theme.muted }}>|</Text>
        </Text>
        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.foreground }}>
          <Image source="sf:arrow.up" style={{ width: 15, height: 15 }} tintColor={theme.background as string} />
        </View>
      </View>
    </View>
  )
}

/** Two app windows with an agent creature driving the cursor. */
function ComputerIllustration() {
  const { theme, isDark } = useTheme()
  const windowStyle = {
    position: 'absolute' as const,
    borderRadius: 12,
    borderCurve: 'continuous' as const,
    backgroundColor: isDark ? '#27272a' : '#ffffff',
    borderWidth: 0.5,
    borderColor: theme.border,
    overflow: 'hidden' as const,
    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
  }
  const bar = (
    <View style={{ height: 24, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, backgroundColor: isDark ? '#3f3f46' : '#f4f4f5' }}>
      {['#ef4444', '#f59e0b', '#22c55e'].map((color) => (
        <View key={color} style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color }} />
      ))}
    </View>
  )
  const line = (width: number) => (
    <View style={{ height: 8, width, borderRadius: 4, backgroundColor: theme.surfaceMuted }} />
  )
  return (
    <View
      style={{
        width: '100%',
        aspectRatio: 1.45,
        borderRadius: 24,
        borderCurve: 'continuous',
        backgroundColor: theme.surfaceSubtle,
      }}
    >
      <View style={[windowStyle, { left: '9%', top: '12%', width: '62%', height: '58%' }]}>
        {bar}
        <View style={{ padding: 12, gap: 8 }}>{line(90)}{line(120)}{line(70)}</View>
      </View>
      <View style={[windowStyle, { right: '8%', bottom: '10%', width: '60%', height: '56%' }]}>
        {bar}
        <View style={{ padding: 12, gap: 8 }}>{line(110)}{line(80)}{line(124)}</View>
      </View>
      <View style={{ position: 'absolute', left: '50%', top: '30%' }}>
        <Image source="sf:cursorarrow" style={{ width: 22, height: 22, marginLeft: -10, marginBottom: -4 }} tintColor="#14b8a6" />
        <AgentAvatar
          agent={{ name: 'Agent', avatarShape: 'circle', avatarColor: '#14b8a6' }}
          dark={isDark}
          foreground={theme.foreground}
          size={58}
          working
        />
      </View>
    </View>
  )
}

const TEAM = [
  { name: 'Invoice chaser', shape: 'circle', color: '#dc2626', x: 0.3, y: 0 },
  { name: 'Sales forecast', shape: 'blob', color: '#ea580c', x: 0.62, y: 0.3 },
  { name: 'Weekly standup', shape: 'squircle', color: '#14b8a6', x: 0.02, y: 0.36 },
  { name: 'Chief of Staff', shape: 'overlay', color: '', x: 0.32, y: 0.66 },
]

/** Example agents, each with the job it was handed. */
function HandoffIllustration() {
  const { theme, isDark } = useTheme()
  return (
    <View style={{ width: '100%', aspectRatio: 0.95 }}>
      {TEAM.map((member, position) => (
        <Animated.View
          key={member.name}
          entering={FadeInDown.delay(120 + position * 110).duration(420)}
          style={{ position: 'absolute', left: `${member.x * 100}%`, top: `${member.y * 100}%`, alignItems: 'center', gap: 8 }}
        >
          <AgentAvatar
            agent={{ name: member.name, isDefault: member.shape === 'overlay', avatarShape: member.shape, avatarColor: member.color }}
            dark={isDark}
            foreground={theme.foreground}
            size={68}
            working={position === 0}
          />
          <View style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: theme.surfaceSubtle }}>
            <Text style={{ fontFamily: 'GeistMedium', fontSize: 14, color: theme.foreground }}>{member.name}</Text>
          </View>
        </Animated.View>
      ))}
    </View>
  )
}

function NotificationsIllustration() {
  const { theme, isDark } = useTheme()
  return (
    <View style={{ alignItems: 'center', gap: 28 }}>
      <View style={{ alignItems: 'center' }}>
        <View style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: theme.surfaceSubtle, marginBottom: -6, zIndex: 1 }}>
          <Text style={{ fontFamily: 'GeistMedium', fontSize: 14, color: theme.foreground }}>Your report is ready</Text>
        </View>
        <View style={{ width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? '#3b1a2b' : '#fce7f3' }}>
          <AgentAvatar
            agent={{ name: 'Agent', avatarShape: 'triangle', avatarColor: '#db2777' }}
            dark={isDark}
            foreground={theme.foreground}
            size={72}
            working
          />
        </View>
      </View>
      <Text style={{ fontFamily: 'Geist', fontSize: 17, lineHeight: 24, textAlign: 'center', color: theme.muted, maxWidth: 320 }}>
        Your agents tell you when something needs your attention or is ready for review.
      </Text>
    </View>
  )
}
