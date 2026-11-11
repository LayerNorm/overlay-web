import React from 'react'
import { TextInput, View } from 'react-native'
import { Bell } from 'lucide-react-native'
import type { Theme } from '../../constants/theme'
import { ResourceState } from '../knowledge/ResourceViews'
import { Button, T } from '../shell/primitives'

export function AccountDeletionConfirmation({
  theme,
  confirmation,
  onChange,
  onConfirm,
  busy = false,
  disabled = false,
  error,
}: {
  theme: Theme
  confirmation: string
  onChange: (value: string) => void
  onConfirm: () => void
  busy?: boolean
  disabled?: boolean
  error?: string | null
}) {
  return (
    <View style={{ gap: 16 }}>
      {error ? <ResourceState theme={theme} error={error} /> : null}
      <T style={{ color: theme.muted, fontSize: 13, lineHeight: 21 }}>
        This permanently deletes your account and its data. Type DELETE, then sign in again with
        this account to confirm.
      </T>
      <T style={{ color: theme.muted, fontSize: 12 }}>Confirmation</T>
      <TextInput
        accessibilityLabel="Confirmation"
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!busy}
        value={confirmation}
        onChangeText={onChange}
        style={{
          color: theme.foreground,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 8,
          padding: 12,
          fontFamily: 'Geist',
          fontSize: 14,
        }}
      />
      <Button
        theme={theme}
        secondary
        disabled={confirmation !== 'DELETE' || busy || disabled}
        onPress={() => {
          if (confirmation === 'DELETE' && !busy && !disabled) onConfirm()
        }}
      >
        {busy ? 'Completing deletion…' : 'Sign in again & delete account'}
      </Button>
    </View>
  )
}

export function PushPrePrompt({
  theme,
  permission,
  busy = false,
  onContinue,
  onLater,
}: {
  theme: Theme
  permission?: string
  busy?: boolean
  onContinue: () => void
  onLater: () => void
}) {
  return (
    <View style={{ gap: 16 }}>
      <Bell size={26} color={theme.foreground} />
      <T style={{ color: theme.muted, fontSize: 13, lineHeight: 21 }}>
        Allow important updates while using the app. Background notifications are not available yet.
      </T>
      <Button theme={theme} secondary disabled={busy} onPress={onContinue}>
        {permission?.startsWith('Denied') ? 'Open device settings' : 'Enable notifications'}
      </Button>
      <Button theme={theme} disabled={busy} onPress={onLater}>
        Not now
      </Button>
      {permission ? (
        <T style={{ color: theme.muted, fontSize: 11 }}>Device permission: {permission}</T>
      ) : null}
    </View>
  )
}
