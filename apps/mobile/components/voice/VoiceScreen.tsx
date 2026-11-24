import React, { useCallback, useEffect, useState } from 'react'
import { Alert, AppState, Linking } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { Button, Host, List, Section, Text, Toggle, VStack } from '@expo/ui/swift-ui'
import {
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  lineLimit,
  listStyle,
  multilineTextAlignment,
  tint,
} from '@expo/ui/swift-ui/modifiers'
import { useTheme } from '../../hooks/useTheme'
import { useAppSession } from '../../contexts/AppSessionContext'
import { useSwitchTint } from '../../lib/nativeControls'
import { FeatureGate } from '../ui/FeatureGate'
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

const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' })

/**
 * Voice: turn keyboard dictation on or off and browse what it transcribed.
 * A native inset-grouped list under the system header: tap a transcription
 * to copy it, swipe to delete it. Dictations happen in other apps, so the
 * list reloads whenever Overlay comes back to the foreground.
 *
 * Rows are plain buttons: wrapping them in a ContextMenu makes List.ForEach
 * report the wrong row index on delete.
 */
export function VoiceScreen(): React.ReactElement {
  const { theme, isDark } = useTheme()
  const switchTint = useSwitchTint()
  const router = useRouter()
  const { isFeatureEnabled } = useAppSession()
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
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') void refresh()
      })
      return () => subscription.remove()
    }, [refresh]),
  )

  const handleToggle = useCallback(
    async (next: boolean) => {
      if (busy) return
      setBusy(true)
      // Show the switch where the person put it; the result below moves it
      // back if that failed (the native switch only redraws on a change).
      setEnabled(next)
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
        }
      } catch {
        setEnabled(await getBackgroundVoiceEnabled())
      } finally {
        setBusy(false)
      }
    },
    [busy],
  )

  const remove = (ids: string[]) => {
    setTranscriptions((prev) => prev.filter((item) => !ids.includes(item.id)))
    void Promise.all(ids.map((id) => deleteTranscription(id))).catch(() => void refresh())
  }

  // Arriving from the keyboard's `overlay://dictate` link turns dictation on.
  useEffect(() => {
    if (didAutoEnable || params?.autoEnable !== '1') return
    setDidAutoEnable(true)
    if (!enabled) void handleToggle(true)
  }, [didAutoEnable, params?.autoEnable, enabled, handleToggle])

  if (!isFeatureEnabled('voiceTranscription')) {
    return <FeatureGate title="Voice dictation is turned off" />
  }

  return (
    <Host style={{ flex: 1 }} colorScheme={isDark ? 'dark' : 'light'}>
      <List modifiers={[listStyle('insetGrouped'), tint(theme.foreground as string)]}>
        <Section
          footer={
            <Text>
              {enabled
                ? 'Tap Start in the Overlay keyboard to record. It transcribes and pastes without leaving the app you are in.'
                : 'Turn on to dictate from the Overlay keyboard in any app.'}
            </Text>
          }
        >
          <Toggle
            label="Keyboard dictation"
            systemImage="waveform"
            isOn={enabled}
            onIsOnChange={(value) => void handleToggle(value)}
            modifiers={[...switchTint, disabled(busy)]}
          />
          {permission === 'denied' ? (
            <Button
              label="Allow microphone access"
              systemImage="mic.slash"
              onPress={() => void Linking.openSettings()}
            />
          ) : null}
        </Section>

        <Section
          title="Transcriptions"
          footer={
            <Text>
              {transcriptions.length
                ? 'Tap to copy. Swipe left to delete.'
                : 'Finished keyboard dictations appear here.'}
            </Text>
          }
        >
          <List.ForEach onDelete={(indices) => remove(indices.map((index) => transcriptions[index]!.id))}>
            {transcriptions.map((item) => (
              <Button key={item.id} onPress={() => void Clipboard.setStringAsync(item.text)} modifiers={[buttonStyle('borderless')]}>
                <VStack alignment="leading" spacing={4}>
                  <Text modifiers={[lineLimit(4), multilineTextAlignment('leading')]}>{item.text}</Text>
                  <Text modifiers={[secondary, font({ size: 13 })]}>{formatTranscriptionDate(item.createdAt)}</Text>
                </VStack>
              </Button>
            ))}
          </List.ForEach>
        </Section>

        <Section>
          <Button
            label="Voice settings"
            systemImage="gearshape"
            onPress={() => router.push({ pathname: '/settings', params: { section: 'voice' } })}
          />
        </Section>
      </List>
    </Host>
  )
}

function formatTranscriptionDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recent'
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
