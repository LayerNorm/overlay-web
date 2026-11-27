import React from 'react'
import { View } from 'react-native'
import { Button as SwiftButton, Section, Text as SwiftText, TextField } from '@expo/ui/swift-ui'
import { autocorrectionDisabled, disabled as swiftDisabled, textInputAutocapitalization } from '@expo/ui/swift-ui/modifiers'
import { Bell } from 'lucide-react-native'
import type { Theme } from '../../constants/theme'
import { ResourceState } from '../knowledge/ResourceViews'
import { Button, T } from '../shell/primitives'

/**
 * Form sections for deleting the account: the word DELETE must be typed
 * exactly, and the destructive button does nothing while busy or disabled.
 * A failed attempt keeps the typed confirmation.
 */
export function AccountDeletionConfirmation({
  confirmation,
  onChange,
  onConfirm,
  busy = false,
  disabled = false,
  error,
}: {
  confirmation: string
  onChange: (value: string) => void
  onConfirm: () => void
  busy?: boolean
  disabled?: boolean
  error?: string | null
}) {
  const ready = confirmation === 'DELETE' && !busy && !disabled
  return (
    <>
      <Section
        title="Type DELETE to confirm"
        footer={<SwiftText>This permanently deletes your account and its data. You&apos;ll sign in once more with this account to confirm.</SwiftText>}
      >
        <TextField
          defaultValue={confirmation}
          placeholder="DELETE"
          onValueChange={onChange}
          modifiers={[textInputAutocapitalization('characters'), autocorrectionDisabled(true)]}
        />
      </Section>
      {error ? (
        <Section>
          <SwiftText>{error}</SwiftText>
        </Section>
      ) : null}
      <Section>
        <SwiftButton
          role="destructive"
          label={busy ? 'Deleting…' : 'Sign in again and delete'}
          modifiers={[swiftDisabled(!ready)]}
          onPress={() => {
            if (ready) onConfirm()
          }}
        />
      </Section>
    </>
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
