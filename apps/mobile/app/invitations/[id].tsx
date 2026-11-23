/**
 * Workspace invitation — native counterpart of web
 * `/app/invitations/[invitationId]`: accept → POST
 * `/workspace-invitations/{id}/accept` → activate the joined workspace and
 * open it. Invitations are bound to the invited email address, so the page
 * names the account that will accept; a 401 offers signing in with another
 * account.
 */
import React, { useState } from 'react'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { Button, Form, Host, LabeledContent, Section, Text } from '@expo/ui/swift-ui'
import { tint } from '@expo/ui/swift-ui/modifiers'
import { useTheme } from '../../hooks/useTheme'
import { useAuth } from '../../contexts/AuthContext'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { acceptWorkspaceInvitation } from '../../services/workspaceManagementService'
import { OverlayApiError } from '../../services/appApi'

export default function InvitationScreen(): React.ReactElement {
  const { theme, isDark } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user, signOut } = useAuth()
  const { refresh, switchWorkspace } = useWorkspace()
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requiresSignIn, setRequiresSignIn] = useState(false)

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/chat'))

  const accept = async () => {
    if (!id || accepting) return
    setAccepting(true)
    setError(null)
    setRequiresSignIn(false)
    try {
      const response = await acceptWorkspaceInvitation(id)
      await refresh()
      const joined = response.activeWorkspaceId ?? response.workspace?.id
      if (joined) await switchWorkspace(joined).catch(() => undefined)
      router.replace('/chat')
    } catch (cause) {
      if (cause instanceof OverlayApiError && cause.status === 401) setRequiresSignIn(true)
      setError(cause instanceof Error ? cause.message : 'Could not accept this invitation.')
    } finally {
      setAccepting(false)
    }
  }

  const switchAccount = () =>
    void signOut()
      .catch(() => undefined)
      .then(() => router.replace('/auth-flow'))

  return (
    <>
      <Stack.Screen options={{ title: 'Join workspace' }} />
      <Host style={{ flex: 1 }} colorScheme={isDark ? 'dark' : 'light'}>
        <Form modifiers={[tint(theme.foreground as string)]}>
          <Section
            title="You're invited"
            footer={<Text>{'Invitations only work for the email address they were sent to. Expired, cancelled or already used invitations can’t be accepted.'}</Text>}
          >
            <LabeledContent label="Accepting as">
              <Text>{user?.email ?? 'Not signed in'}</Text>
            </LabeledContent>
          </Section>
          {error ? (
            <Section title="Couldn't join">
              <Text>{error}</Text>
            </Section>
          ) : null}
          <Section>
            {requiresSignIn || !user ? (
              <Button label="Sign in with another account" onPress={switchAccount} />
            ) : (
              <Button label={accepting ? 'Joining…' : 'Accept invitation'} onPress={() => void accept()} />
            )}
            <Button label="Not now" onPress={leave} />
          </Section>
        </Form>
      </Host>
    </>
  )
}
