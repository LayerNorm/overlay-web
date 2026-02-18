import React, { useEffect, useRef, useState } from 'react'
import {
  InputAccessoryView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  ActivityIndicator
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import type { Theme } from '../../constants/theme'

const PUNCTUATION_KEYS = ['.', ',', '?', '!', "'"] as const

interface DictationAccessoryStripProps {
  accessoryID: string
  theme: Theme
  isRecording: boolean
  isProcessing: boolean
  error: string | null
  onMicTap: () => Promise<void>
  onMicHoldStart: () => Promise<void>
  onMicHoldEnd: () => Promise<void>
  onInsertText: (text: string) => void
  onDeleteBackward: () => void
  onReturn: () => void
}

interface WaveformProps {
  active: boolean
  color: string
}

function Waveform({ active, color }: WaveformProps): React.ReactElement {
  const [levels, setLevels] = useState<number[]>([0.25, 0.4, 0.3, 0.45, 0.25, 0.35])

  useEffect(() => {
    if (!active) {
      setLevels([0.25, 0.4, 0.3, 0.45, 0.25, 0.35])
      return
    }

    const timer = setInterval(() => {
      setLevels((prev) => prev.map(() => 0.2 + Math.random() * 0.8))
    }, 90)

    return () => {
      clearInterval(timer)
    }
  }, [active])

  return (
    <View style={styles.waveform}>
      {levels.map((value, index) => (
        <View
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          style={[
            styles.waveBar,
            {
              backgroundColor: color,
              height: 4 + value * 14,
              opacity: active ? 0.95 : 0.45
            }
          ]}
        />
      ))}
    </View>
  )
}

export function DictationAccessoryStrip({
  accessoryID,
  theme,
  isRecording,
  isProcessing,
  error,
  onMicTap,
  onMicHoldStart,
  onMicHoldEnd,
  onInsertText,
  onDeleteBackward,
  onReturn
}: DictationAccessoryStripProps): React.ReactElement | null {
  const didLongPressRef = useRef(false)

  if (Platform.OS !== 'ios') {
    return null
  }

  const micAccent = '#EF4444'
  const micIconColor = isRecording ? '#FFFFFF' : theme.toggleThumb
  const micBackground = isRecording ? micAccent : theme.buttonBg

  const statusLabel = (() => {
    if (error) return error
    if (isProcessing) return 'Transcribing...'
    if (isRecording) return 'Listening... tap to stop or release to finish'
    return 'Tap to dictate, hold for push-to-talk'
  })()

  const statusColor = (() => {
    if (error) return micAccent
    if (isProcessing) return theme.textSecondary
    if (isRecording) return micAccent
    return theme.textSecondary
  })()

  const pressKey = (text: string): void => {
    void Haptics.selectionAsync()
    onInsertText(text)
  }

  const handleDeletePress = (): void => {
    void Haptics.selectionAsync()
    onDeleteBackward()
  }

  const handleReturnPress = (): void => {
    void Haptics.selectionAsync()
    onReturn()
  }

  const handleMicTap = (): void => {
    if (didLongPressRef.current) {
      didLongPressRef.current = false
      return
    }
    void onMicTap()
  }

  const handleMicLongPress = (): void => {
    if (isProcessing || isRecording) {
      return
    }
    didLongPressRef.current = true
    void onMicHoldStart()
  }

  const handleMicPressOut = (): void => {
    if (!didLongPressRef.current) {
      return
    }
    void onMicHoldEnd()
  }

  return (
    <InputAccessoryView nativeID={accessoryID} backgroundColor={theme.background}>
      <View style={[styles.container, { backgroundColor: theme.background, borderTopColor: theme.border }]}>
        <View style={[styles.micRow, { backgroundColor: theme.surface }]}>
          <Pressable
            style={[styles.micButton, { backgroundColor: micBackground }]}
            onPress={handleMicTap}
            onLongPress={handleMicLongPress}
            onPressOut={handleMicPressOut}
            delayLongPress={180}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color={theme.textSecondary} />
            ) : (
              <Feather name={isRecording ? 'square' : 'mic'} size={isRecording ? 13 : 17} color={micIconColor} />
            )}
          </Pressable>

          <Waveform active={isRecording} color={isRecording ? micAccent : theme.textDisabled} />

          <Text style={[styles.statusText, { color: statusColor }]} numberOfLines={1}>
            {statusLabel}
          </Text>
        </View>

        <View style={styles.keyRow}>
          {PUNCTUATION_KEYS.map((keyChar) => (
            <Pressable
              key={keyChar}
              style={[styles.smallKey, { backgroundColor: theme.surface }]}
              onPress={() => pressKey(keyChar)}
            >
              <Text style={[styles.keyText, { color: theme.text }]}>{keyChar}</Text>
            </Pressable>
          ))}

          <Pressable
            style={[styles.spaceKey, { backgroundColor: theme.surface }]}
            onPress={() => pressKey(' ')}
          >
            <Text style={[styles.spaceText, { color: theme.textSecondary }]}>space</Text>
          </Pressable>

          <Pressable
            style={[styles.utilityKey, { backgroundColor: theme.surface }]}
            onPress={handleDeletePress}
          >
            <Feather name="delete" size={16} color={theme.text} />
          </Pressable>

          <Pressable
            style={[styles.utilityKey, { backgroundColor: theme.surface }]}
            onPress={handleReturnPress}
          >
            <Feather name="corner-down-left" size={16} color={theme.text} />
          </Pressable>
        </View>
      </View>
    </InputAccessoryView>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 8,
    borderTopWidth: 1
  },
  micRow: {
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 10
  },
  micButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center'
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3
  },
  waveBar: {
    width: 3,
    borderRadius: 1.5
  },
  statusText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500'
  },
  keyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  smallKey: {
    width: 30,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center'
  },
  keyText: {
    fontSize: 18,
    fontWeight: '500',
    lineHeight: 22
  },
  spaceKey: {
    flex: 1,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center'
  },
  spaceText: {
    fontSize: 13,
    fontWeight: '500'
  },
  utilityKey: {
    width: 36,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center'
  }
})
