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

  const permissionWarning =
    permission === 'denied' ? 'Microphone access denied — open Settings to allow it.' : null

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
            <View style={[styles.statusDot, { backgroundColor: enabled ? '#22C55E' : theme.mutedLight }]} />
            <Text style={[styles.cardTitle, { color: theme.text }]}>
              {enabled ? 'Background mic on' : 'Background mic off'}
            </Text>
          </View>
          <Text style={[styles.cardBody, { color: theme.textSecondary }]}>
            {enabled
              ? 'Tap Start in the keyboard. We record, transcribe, and paste — no app switching.'
              : 'Enable to record from the keyboard without leaving the app you\'re in.'}
          </Text>
          {permissionWarning ? (
            <View style={[styles.warningRow, { borderColor: theme.border }]}>
              <Feather name="alert-circle" size={14} color="#F59E0B" />
              <Text style={[styles.warningText, { color: theme.text }]}>{permissionWarning}</Text>
            </View>
          ) : null}
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
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.xs,
  },
  warningText: {
    fontSize: fontSize.sm,
    flex: 1,
  },
})
