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
  error,
  theme,
  permission,
  busy = false,
  onContinue,
  onLater,
}: {
  error?: string | null
  theme: Theme
  permission?: string
  busy?: boolean
  onContinue: () => void
  onLater: () => void
}) {
  const denied = permission?.startsWith('Denied')
  return (
    <View style={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: 14, paddingHorizontal: 12, paddingBottom: 80 }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceSubtle }}>
        <Bell size={30} color={theme.foreground} />
      </View>
      <T style={{ color: theme.foreground, fontSize: 20, fontFamily: 'GeistSemibold', textAlign: 'center' }}>
        Stay in the loop
      </T>
      <T style={{ color: theme.muted, fontSize: 15, lineHeight: 21, textAlign: 'center' }}>
        Know when your agents need you or important updates arrive, even when the app is closed.
      </T>
      {error ? <ResourceState theme={theme} error={error} /> : null}
      <View style={{ alignSelf: 'stretch', gap: 8, marginTop: 10 }}>
        <Button theme={theme} secondary disabled={busy} onPress={onContinue}>
          {denied ? 'Open device settings' : 'Enable notifications'}
        </Button>
        <Button theme={theme} disabled={busy} onPress={onLater}>
          Not now
        </Button>
      </View>
      {denied ? (
        <T style={{ color: theme.muted, fontSize: 12, textAlign: 'center' }}>
          Notifications are turned off for Overlay in iOS Settings.
        </T>
      ) : null}
    </View>
  )
}
