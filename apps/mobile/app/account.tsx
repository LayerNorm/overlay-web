import React, { useState } from 'react'
import { Alert } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { Button, Form, Host, Picker, Section, Text } from '@expo/ui/swift-ui'
import { pickerStyle, tag, tint } from '@expo/ui/swift-ui/modifiers'
import { useAuth } from '../contexts/AuthContext'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { useAppSession } from '../contexts/AppSessionContext'
import { useTheme } from '../hooks/useTheme'
import { showShellExtensions } from '../lib/shellNavigation'

/**
 * Account sheet (opened from the person button in every tab's header):
 * workspace switcher plus the destinations that don't get a tab.
 */
export default function AccountSheet(): React.ReactElement {
  const router = useRouter()
  const { theme, isDark } = useTheme()
  const { user, signOut } = useAuth()
  const workspace = useWorkspace()
  const { bootstrap, isFeatureEnabled } = useAppSession()
  const [pendingId, setPendingId] = useState<string | null>(null)

  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || 'Account'
  const go = (path: string) => {
    router.dismiss()
    router.push(path as never)
  }
  const confirmSignOut = () =>
    Alert.alert('Sign out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => {
          void signOut()
            .then(() => {
              if (router.canDismiss()) router.dismiss()
              router.replace('/auth-flow')
            })
            .catch(() => Alert.alert('Unable to sign out', 'Please try again.'))
        },
      },
    ])

  const newWorkspace = () =>
    Alert.prompt(
      'New workspace',
      'Workspaces hold shared agents, channels, files and their own billing.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create',
          onPress: (value?: string) => {
            const trimmed = value?.trim().slice(0, 64)
            if (!trimmed) return
            void workspace
              .createWorkspace(trimmed)
              .then(() => { if (router.canDismiss()) router.dismiss() })
              .catch((error) =>
                Alert.alert('Could not create the workspace', error instanceof Error ? error.message : 'Try again in a moment.'),
              )
          },
        },
      ],
      'plain-text',
    )

  const selectedWorkspace = pendingId ?? workspace.activeWorkspaceId ?? ''
  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" onPress={() => router.dismiss()} />
      </Stack.Toolbar>
      <Host style={{ flex: 1 }} colorScheme={isDark ? 'dark' : 'light'}>
        <Form modifiers={[tint(theme.foreground as string)]}>
          <Section footer={<Text>{user?.email ?? ''}</Text>}>
            <Button onPress={() => go('/settings?section=account')} systemImage="person.crop.circle" label={name} />
          </Section>
          {workspace.workspacesEnabled && workspace.workspaces.length ? (
            <Section title="Workspace">
              <Picker
                selection={selectedWorkspace}
                onSelectionChange={(id: string) => {
                  if (!id || id === workspace.activeWorkspaceId || workspace.isSwitching) return
                  setPendingId(id)
                  void workspace
                    .switchWorkspace(id)
                    .then(() => { if (router.canDismiss()) router.dismiss() })
                    .catch(() => Alert.alert('Could not switch workspace', 'Check your connection and try again.'))
                    .finally(() => setPendingId(null))
                }}
                modifiers={[pickerStyle('inline')]}
              >
                {workspace.workspaces.map((item) => (
                  <Text key={item.id} modifiers={[tag(item.id)]}>
                    {item.name}
                  </Text>
                ))}
              </Picker>
              <Button onPress={() => go('/workspace')} systemImage="building.2" label="Manage workspace" />
              <Button onPress={newWorkspace} systemImage="plus" label="New workspace" />
            </Section>
          ) : null}
          <Section>
            {isFeatureEnabled('automations') ? (
              <Button onPress={() => go('/automations')} systemImage="bolt.badge.clock" label="Automations" />
            ) : null}
            {showShellExtensions(bootstrap?.featureFlagRegistry, isFeatureEnabled('extensions')) ? (
              <Button onPress={() => go('/tools')} systemImage="puzzlepiece.extension" label="Extensions" />
            ) : null}
            <Button onPress={() => go('/activity')} systemImage="bell" label="Activity" />
            <Button onPress={() => go('/voice')} systemImage="waveform" label="Voice" />
          </Section>
          <Section>
            <Button onPress={() => go('/settings')} systemImage="gearshape" label="Settings" />
            <Button onPress={() => go('/onboarding')} systemImage="sparkles" label="See the intro" />
          </Section>
          <Section>
            <Button role="destructive" onPress={confirmSignOut} label="Sign Out" />
          </Section>
        </Form>
      </Host>
    </>
  )
}
