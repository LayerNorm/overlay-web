import React, { useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native'
import { Check, X } from 'lucide-react-native'
import type { Theme } from '../../constants/theme'
import { IconButton, T } from '../shell/primitives'

export function WorkField({ theme, style, ...props }: TextInputProps & { theme: Theme }) {
  return (
    <TextInput
      {...props}
      placeholderTextColor={theme.muted}
      style={[
        {
          fontFamily: 'Geist',
          fontSize: 14,
          color: theme.foreground,
          backgroundColor: theme.surfaceMuted,
          borderRadius: 8,
          padding: 12,
          minHeight: 42,
          includeFontPadding: false,
        },
        style,
      ]}
    />
  )
}

export function WorkSheet({
  title,
  theme,
  onClose,
  children,
  bottomInset = 0,
  minHeight,
}: {
  title: string
  theme: Theme
  onClose: () => void
  children: React.ReactNode
  bottomInset?: number
  minHeight?: number
}) {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, justifyContent: 'flex-end' }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss sheet"
        onPress={onClose}
        style={{ flex: 1 }}
      />
      <View
        accessibilityViewIsModal
        style={{
          maxHeight: '92%',
          minHeight,
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          paddingHorizontal: 22,
          paddingTop: 10,
          paddingBottom: 28 + bottomInset,
          backgroundColor: theme.surfaceElevated,
        }}
      >
        <View
          style={{
            width: 34,
            height: 4,
            borderRadius: 5,
            backgroundColor: theme.border,
            alignSelf: 'center',
            marginBottom: 15,
          }}
        />
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <T style={{ fontSize: 20, fontWeight: '500', color: theme.foreground }}>{title}</T>
          <IconButton icon={X} label="Close sheet" onPress={onClose} theme={theme} />
        </View>
        <ScrollView contentInsetAdjustmentBehavior="never" keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
          {children}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  )
}

export function WorkOptions({
  title,
  theme,
  choices,
  selected,
  onSelect,
  onClose,
  error,
  busy = false,
}: {
  title: string
  theme: Theme
  choices: Array<{ id: string; label: string }>
  selected: string[]
  onSelect: (id: string) => void
  onClose: () => void
  error?: string | null
  busy?: boolean
}) {
  const [query, search] = useState('')
  const filtered = choices.filter((choice) =>
    choice.label.toLowerCase().includes(query.toLowerCase()),
  )
  return (
    <WorkSheet title={title} theme={theme} onClose={onClose}>
      <WorkField
        theme={theme}
        accessibilityLabel="Search options"
        placeholder="Search..."
        value={query}
        onChangeText={search}
      />
      {error ? (
        <T accessibilityRole="alert" style={{ color: theme.foreground }}>
          {error}
        </T>
      ) : null}
      {filtered.map((choice) => (
        <Pressable
          key={choice.id}
          accessibilityRole="button"
          accessibilityState={{ selected: selected.includes(choice.id), disabled: busy }}
          disabled={busy}
          onPress={() => onSelect(choice.id)}
          style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 }}
        >
          <T style={{ flex: 1, fontSize: 14, color: theme.foreground }}>{choice.label}</T>
          {selected.includes(choice.id) ? <Check color={theme.foreground} size={16} /> : null}
        </Pressable>
      ))}
      {!filtered.length ? <T style={{ color: theme.muted }}>No matches.</T> : null}
    </WorkSheet>
  )
}
