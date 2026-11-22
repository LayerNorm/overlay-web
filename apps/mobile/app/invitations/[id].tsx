/**
 * Workspace invitation landing — native counterpart of web
 * `/app/invitations/[invitationId]`: accept card → POST
 * `/workspace-invitations/{id}/accept` → activate the joined workspace and
 * route into it. 401 surfaces a sign-in prompt (invitations are bound to the
 * invited email address).
 */
import React, { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useTheme } from '../../hooks/useTheme'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { acceptWorkspaceInvitation } from '../../services/workspaceManagementService'
import { OverlayApiError } from '../../services/appApi'
import { borderRadius, fontSize, spacing } from '../../constants/theme'

export default function InvitationScreen(): React.ReactElement {
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { refresh, switchWorkspace } = useWorkspace()
  const [status, setStatus] = useState<'idle' | 'accepting' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [requiresSignIn, setRequiresSignIn] = useState(false)

  const accept = useCallback(async () => {
    if (!id || status === 'accepting') return
    setStatus('accepting')
    setError(null)
    setRequiresSignIn(false)
    try {
      const response = await acceptWorkspaceInvitation(id)
      await refresh()
      if (response.activeWorkspaceId) {
        await switchWorkspace(response.activeWorkspaceId).catch(() => undefined)
      }
      router.replace('/chat')
    } catch (acceptError) {
      if (acceptError instanceof OverlayApiError && acceptError.status === 401) {
        setRequiresSignIn(true)
      }
      setStatus('error')
      setError(
        acceptError instanceof Error ? acceptError.message : 'Could not accept this invitation.',
      )
    }
  }, [id, status, refresh, switchWorkspace, router])

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}>
        <View style={[styles.iconWrap, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
          <Feather name="users" size={21} color={theme.text} />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>Join an Overlay workspace</Text>
        <Text style={[styles.description, { color: theme.textSecondary }]}>
          Invitations are bound to the exact invited email address. Sign in with that account, then
          accept to join.
        </Text>
        {error ? (
          <View style={styles.errorBox}>
            <Feather name="alert-circle" size={14} color="#EF4444" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
        {requiresSignIn ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => router.replace('/auth-flow')}
            style={[styles.button, { backgroundColor: theme.foreground }]}
          >
            <Text style={[styles.buttonText, { color: theme.background }]}>Sign in to continue</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            activeOpacity={0.85}
            disabled={status === 'accepting'}
            onPress={() => void accept()}
            style={[styles.button, { backgroundColor: theme.foreground }]}
          >
            {status === 'accepting' ? (
              <ActivityIndicator size="small" color={theme.background} />
            ) : (
              <Text style={[styles.buttonText, { color: theme.background }]}>Accept invitation</Text>
            )}
          </TouchableOpacity>
        )}
        <Text style={[styles.footnote, { color: theme.textDisabled }]}>
          Expired, cancelled, replaced, or already-used invitations cannot be accepted.
        </Text>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={[styles.backLink, { color: theme.textSecondary }]}>Go back</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: {
    width: '100%',
    maxWidth: 420,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    alignItems: 'center',
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: { fontSize: fontSize.lg, fontWeight: '700', marginBottom: spacing.xs },
  description: { fontSize: fontSize.sm, lineHeight: 20, textAlign: 'center', maxWidth: 320 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    borderRadius: borderRadius.lg,
    backgroundColor: 'rgba(239,68,68,0.08)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
    alignSelf: 'stretch',
  },
  errorText: { flex: 1, fontSize: fontSize.xs, color: '#EF4444', lineHeight: 16 },
  button: {
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
    marginTop: spacing.lg,
    minWidth: 180,
    alignItems: 'center',
  },
  buttonText: { fontSize: fontSize.sm, fontWeight: '700' },
  footnote: { fontSize: 11, textAlign: 'center', marginTop: spacing.md, maxWidth: 300 },
  backLink: { fontSize: fontSize.sm, marginTop: spacing.sm },
})
