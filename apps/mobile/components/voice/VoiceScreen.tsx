import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { useTheme } from '../../hooks/useTheme'
import { useDrawer } from '../../contexts/DrawerContext'
import { MainScreenHeader, TopBarIconButton } from '../ui/AppChrome'
import { ScreenWithDrawer } from '../ui/ScreenWithDrawer'
import { DrawerSidebar } from '../chat/DrawerSidebar'
import {
  disableBackgroundVoice,
  enableBackgroundVoice,
  getBackgroundVoiceEnabled,
  getMicPermission,
  syncAuthSessionToAppGroup,
  type VoicePermission,
} from '../../services/voiceService'

export function VoiceScreen(): React.ReactElement {
  const { theme, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const { openDrawer } = useDrawer()
  const params = useLocalSearchParams<{ autoEnable?: string }>()

  const [enabled, setEnabled] = useState(false)
  const [permission, setPermission] = useState<VoicePermission>('undetermined')
  const [busy, setBusy] = useState(false)
  const [didAutoEnable, setDidAutoEnable] = useState(false)

  const refresh = useCallback(async () => {
    const [enabledNow, perm] = await Promise.all([
      getBackgroundVoiceEnabled(),
      getMicPermission(),
    ])
    setEnabled(enabledNow)
    setPermission(perm)
    void syncAuthSessionToAppGroup()
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  const handleToggle = useCallback(
    async (next: boolean) => {
      if (busy) return
      setBusy(true)
      try {
        if (next) {
          const result = await enableBackgroundVoice()
          setEnabled(result.enabled)
          setPermission(result.permission)
          if (!result.enabled && result.permission !== 'granted') {
            Alert.alert(
              'Microphone access needed',
              'Open Settings and allow microphone access for Overlay so the keyboard can record.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Open Settings', onPress: () => void Linking.openSettings() },
              ],
            )
          }
        } else {
          await disableBackgroundVoice()
          setEnabled(false)
        }
      } finally {
        setBusy(false)
      }
    },
    [busy],
  )

  // Auto-enable when arriving from the keyboard's `overlay://dictate` deep link
  useEffect(() => {
    if (didAutoEnable) return
    if (params?.autoEnable !== '1') return
    setDidAutoEnable(true)
    if (!enabled) {
      void handleToggle(true)
    }
  }, [didAutoEnable, params?.autoEnable, enabled, handleToggle])

  const statusText = enabled
    ? 'On — keyboard Start button will record without leaving your current app.'
    : 'Off — tap Start in the keyboard to enable, or flip the switch above.'

  const permissionWarning =
    permission === 'denied'
      ? 'Microphone access is denied. Open Settings to allow it.'
      : null

  return (
    <ScreenWithDrawer
      drawer={
        <DrawerSidebar
          variant="slide"
          theme={theme}
          chats={[]}
          activeChatId={null}
          onSelectChat={() => {}}
          onCreateChat={() => {}}
        />
      }
    >
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['bottom']}>
      <MainScreenHeader
        theme={theme}
        isDark={isDark}
        topInset={insets.top}
        blurHeight={insets.top + 56}
        leftSlot={<TopBarIconButton theme={theme} icon="menu" onPress={openDrawer} />}
        centerSlot={
          <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
            Voice
          </Text>
        }
        rightSlot={
          busy ? (
            <View style={styles.switchSlot}>
              <ActivityIndicator size="small" color={theme.textSecondary} />
            </View>
          ) : (
            <View style={styles.switchSlot}>
              <Switch
                value={enabled}
                onValueChange={(v) => void handleToggle(v)}
                trackColor={{
                  false: theme.surfaceSubtle,
                  true: isDark ? '#FFFFFF' : '#0A0A0A',
                }}
                thumbColor={enabled ? (isDark ? '#0A0A0A' : '#FFFFFF') : '#FFFFFF'}
                ios_backgroundColor={theme.surfaceSubtle}
              />
            </View>
          )
        }
      />

      <View style={[styles.body, { paddingTop: insets.top + 72 }]}>
        <View style={[styles.card, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
          <View style={styles.cardHeaderRow}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: enabled ? '#22C55E' : theme.mutedLight },
              ]}
            />
            <Text style={[styles.cardTitle, { color: theme.text }]}>
              Background voice recording
            </Text>
          </View>
          <Text style={[styles.cardBody, { color: theme.textSecondary }]}>{statusText}</Text>
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <Text style={[styles.cardSubBody, { color: theme.textSecondary }]}>
            When this is on, Overlay keeps a microphone session warm so the keyboard&apos;s Start
            button can record while you stay in the app you were using. Audio is transcribed
            securely through Overlay and pasted into the active text field.
          </Text>
          {permissionWarning ? (
            <View style={[styles.warningRow, { borderColor: theme.border }]}>
              <Feather name="alert-circle" size={14} color="#F59E0B" />
              <Text style={[styles.warningText, { color: theme.text }]}>{permissionWarning}</Text>
            </View>
          ) : null}
        </View>

        <View style={[styles.tipsCard, { backgroundColor: theme.surfaceSubtle }]}>
          <View style={styles.tipRow}>
            <View style={[styles.tipBadge, { backgroundColor: theme.surfaceElevated }]}>
              <Feather name="zap" size={14} color={theme.text} />
            </View>
            <Text style={[styles.tipText, { color: theme.textSecondary }]}>
              Tap <Text style={{ color: theme.text, fontWeight: '600' }}>Start</Text> in the
              keyboard while in any app. We listen, transcribe, and paste — no app switching.
            </Text>
          </View>
          <View style={styles.tipRow}>
            <View style={[styles.tipBadge, { backgroundColor: theme.surfaceElevated }]}>
              <Feather name="x" size={14} color={theme.text} />
            </View>
            <Text style={[styles.tipText, { color: theme.textSecondary }]}>
              Tap <Text style={{ color: theme.text, fontWeight: '600' }}>Cancel</Text> while
              recording to throw it away.
            </Text>
          </View>
          <View style={styles.tipRow}>
            <View style={[styles.tipBadge, { backgroundColor: theme.surfaceElevated }]}>
              <Feather name="phone-off" size={14} color={theme.text} />
            </View>
            <Text style={[styles.tipText, { color: theme.textSecondary }]}>
              If you take a call or another app grabs the mic, the switch flips off — toggle
              it back on to resume.
            </Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
    </ScreenWithDrawer>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerTitle: {
    fontSize: 17,
    fontFamily: 'LibreBaskerville',
    fontWeight: '600',
  },
  switchSlot: {
    width: 56,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  cardTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  cardBody: {
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  cardSubBody: {
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.xs,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.xs,
  },
  warningText: {
    fontSize: fontSize.sm,
    flex: 1,
  },
  tipsCard: {
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    gap: spacing.sm,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  tipBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipText: {
    flex: 1,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
})
