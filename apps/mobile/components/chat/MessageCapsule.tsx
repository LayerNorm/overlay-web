import React from 'react'
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native'
import { Image } from 'expo-image'
import { useTheme } from '../../hooks/useTheme'
import { hapticImpact } from '../../lib/haptics'

/**
 * Chat composer in the style of consumer AI apps: one rounded field that
 * grows with its text, an optional "+" inside on the left and a round send
 * (or stop) button inside on the right. The send button is always present so
 * the field keeps its shape; it fills in once there is something to send.
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
  const { theme, isDark } = useTheme()
  const canSend = !disabled && !sending && value.trim().length > 0
  const showStop = generating && Boolean(onStop)
  const active = showStop || canSend
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: 10 }}>
      <View
        style={{
          minHeight: 52,
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: 4,
          borderRadius: 26,
          borderCurve: 'continuous',
          borderWidth: 0.5,
          borderColor: theme.border,
          backgroundColor: isDark ? theme.surfaceSubtle : theme.background,
          padding: 7,
          paddingLeft: onPlus ? 7 : 18,
          boxShadow: isDark ? undefined : '0 2px 14px rgba(0,0,0,0.07)',
        }}
      >
        {onPlus ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add"
            onPress={onPlus}
            disabled={disabled}
            style={({ pressed }) => ({
              width: 38,
              height: 38,
              borderRadius: 19,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? theme.surfaceMuted : 'transparent',
            })}
          >
            <Image source="sf:plus" style={{ width: 18, height: 18 }} contentFit="contain" tintColor={theme.foreground as string} />
          </Pressable>
        ) : null}
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
            alignSelf: 'center',
            color: theme.foreground,
            fontFamily: 'Geist',
            fontSize: 17,
            lineHeight: 22,
            paddingTop: 8,
            paddingBottom: 8,
            maxHeight: 160,
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showStop ? 'Stop response' : 'Send message'}
          accessibilityState={{ disabled: !active }}
          disabled={!active}
          onPress={() => {
            hapticImpact()
            if (showStop) onStop?.()
            else onSend()
          }}
          style={({ pressed }) => ({
            width: 38,
            height: 38,
            borderRadius: 19,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: active || sending ? theme.foreground : theme.surfaceMuted,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          {sending && !showStop ? (
            <ActivityIndicator size="small" color={theme.background as string} />
          ) : (
            <Image
              source={showStop ? 'sf:stop.fill' : 'sf:arrow.up'}
              style={{ width: showStop ? 12 : 16, height: showStop ? 12 : 16 }}
              contentFit="contain"
              tintColor={(active ? theme.background : theme.mutedLight) as string}
            />
          )}
        </Pressable>
      </View>
    </View>
  )
}
