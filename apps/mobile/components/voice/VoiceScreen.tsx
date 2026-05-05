import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
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
  deleteTranscription,
  getTranscriptionHistory,
  syncAuthSessionToAppGroup,
  type VoiceTranscription,
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
  const [transcriptions, setTranscriptions] = useState<VoiceTranscription[]>([])

  const refresh = useCallback(async () => {
    const [enabledNow, perm, history] = await Promise.all([
      getBackgroundVoiceEnabled(),
      getMicPermission(),
      getTranscriptionHistory(),
    ])
    setEnabled(enabledNow)
    setPermission(perm)
    setTranscriptions(history)
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

  const handleCopy = useCallback(async (text: string) => {
    await Clipboard.setStringAsync(text)
  }, [])

  const handleDeleteTranscription = useCallback((id: string) => {
    Alert.alert('Delete transcription', 'Remove this transcription from Voice history?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteTranscription(id)
          setTranscriptions((prev) => prev.filter((item) => item.id !== id))
        },
      },
    ])
  }, [])

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
                trackColor={{ false: theme.surfaceSubtle, true: '#22C55E' }}
                thumbColor="#FFFFFF"
                ios_backgroundColor={theme.surfaceSubtle}
              />
            </View>
          )
        }
      />

      <ScrollView
        style={styles.bodyScroll}
        contentContainerStyle={[styles.body, { paddingTop: insets.top + 72, paddingBottom: insets.bottom + spacing.xl }]}
      >
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

        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Transcriptions</Text>
          <TouchableOpacity onPress={() => void refresh()} style={styles.iconButton} activeOpacity={0.7}>
            <Feather name="refresh-cw" size={16} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>

        {transcriptions.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
              Completed keyboard dictations will appear here.
            </Text>
          </View>
        ) : (
          <View style={styles.transcriptionList}>
            {transcriptions.map((item) => (
              <View
                key={item.id}
                style={[styles.transcriptionCard, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}
              >
                <View style={styles.transcriptionMetaRow}>
                  <Text style={[styles.transcriptionDate, { color: theme.textSecondary }]}>
                    {formatTranscriptionDate(item.createdAt)}
                  </Text>
                  <View style={styles.transcriptionActions}>
                    <TouchableOpacity onPress={() => void handleCopy(item.text)} style={styles.iconButton} activeOpacity={0.7}>
                      <Feather name="copy" size={16} color={theme.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDeleteTranscription(item.id)} style={styles.iconButton} activeOpacity={0.7}>
                      <Feather name="trash-2" size={16} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                </View>
                <Text style={[styles.transcriptionText, { color: theme.text }]}>{item.text}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
    </ScreenWithDrawer>
  )
}

function formatTranscriptionDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recent'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
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
  bodyScroll: {
    flex: 1,
  },
  body: {
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
  sectionHeaderRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
  },
  emptyText: {
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  transcriptionList: {
    gap: spacing.sm,
  },
  transcriptionCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  transcriptionMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  transcriptionDate: {
    fontSize: fontSize.sm,
    flex: 1,
  },
  transcriptionActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  transcriptionText: {
    fontSize: fontSize.md,
    lineHeight: 22,
  },
})
