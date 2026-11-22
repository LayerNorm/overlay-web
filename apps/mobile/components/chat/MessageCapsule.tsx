import React from 'react'
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native'
import { Image } from 'expo-image'
import { useTheme } from '../../hooks/useTheme'

/**
 * Compact iMessage-style input: a rounded field that grows with its text and
 * a circular send (or stop) button inside it. An optional leading "+" opens
 * attachments or other composer options.
 */
export function MessageCapsule({
  value,
  onChangeText,
  placeholder,
  onSend,
  onStop,
  generating = false,
  disabled = false,
  sending = false,
  onPlus,
  accessibilityLabel,
}: {
  value: string
  onChangeText: (text: string) => void
  placeholder: string
  onSend: () => void
  onStop?: () => void
  generating?: boolean
  disabled?: boolean
  sending?: boolean
  onPlus?: () => void
  accessibilityLabel?: string
}): React.ReactElement {
  const { theme } = useTheme()
  const canSend = !disabled && !sending && value.trim().length > 0
  const showStop = generating && Boolean(onStop)
  const active = showStop || canSend
  const filled = active || sending
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8 }}>
      {onPlus ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add"
          onPress={onPlus}
          disabled={disabled}
          hitSlop={6}
          style={({ pressed }) => ({
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? theme.surfaceMuted : theme.surfaceSubtle,
          })}
        >
          <Image source="sf:plus" style={{ width: 16, height: 16 }} tintColor={theme.foreground as string} />
        </Pressable>
      ) : null}
      <View
        style={{
          flex: 1,
          minHeight: 36,
          flexDirection: 'row',
          alignItems: 'flex-end',
          borderRadius: 18,
          borderCurve: 'continuous',
          borderWidth: 0.5,
          borderColor: theme.border,
          backgroundColor: theme.surfaceSubtle,
          paddingLeft: 14,
          paddingRight: 3,
          paddingVertical: 3,
        }}
      >
        <TextInput
          accessibilityLabel={accessibilityLabel ?? placeholder}
          placeholder={placeholder}
          placeholderTextColor={theme.muted}
          value={value}
          onChangeText={onChangeText}
          editable={!disabled}
          multiline
          style={{
            flex: 1,
            color: theme.foreground,
            fontFamily: 'Geist',
            fontSize: 16,
            lineHeight: 21,
            paddingTop: 5,
            paddingBottom: 5,
            maxHeight: 140,
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showStop ? 'Stop response' : 'Send message'}
          disabled={!active}
          onPress={showStop ? onStop : onSend}
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: filled ? theme.foreground : 'transparent',
            opacity: sending && !showStop ? 0.6 : 1,
          }}
        >
          {sending && !showStop ? (
            <ActivityIndicator size="small" color={theme.background as string} />
          ) : active ? (
            <Image
              source={showStop ? 'sf:stop.fill' : 'sf:arrow.up'}
              style={{ width: showStop ? 11 : 15, height: showStop ? 11 : 15 }}
              tintColor={theme.background as string}
            />
          ) : null}
        </Pressable>
      </View>
    </View>
  )
}
