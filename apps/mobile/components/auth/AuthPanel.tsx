import React, { useCallback } from 'react'
import {
  ActivityIndicator,
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { useTheme } from '../../hooks/useTheme'
import { useAuth } from '../../contexts/AuthContext'
import { getAccountUrl } from '../../services/authService'

interface AuthPanelProps {
  onSignedOut?: () => void
}

export function AuthPanel({
  onSignedOut,
}: AuthPanelProps): React.ReactElement {
  const router = useRouter()
  const { theme } = useTheme()
  const { isLoading, isAuthenticated, authError, signOut, user } = useAuth()

  const openAuthFlow = useCallback(
    (mode: 'sign-in' | 'sign-up') => {
      router.push({
        pathname: '/auth-flow',
        params: {
          mode,
          force: mode === 'sign-in' ? 'true' : 'false',
        },
      })
    },
    [router],
  )

  const handleManageAccount = useCallback(() => {
    void Linking.openURL(getAccountUrl())
  }, [])

  const handleSignOut = useCallback(async () => {
    await signOut()
    onSignedOut?.()
  }, [onSignedOut, signOut])

  if (isLoading && !isAuthenticated) {
    return (
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <ActivityIndicator color={theme.textSecondary} />
        <Text style={[styles.helperText, { color: theme.textSecondary }]}>
          Restoring your chat session…
        </Text>
      </View>
    )
  }

  if (!isAuthenticated || !user) {
    return (
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.copyBlock}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>
            Connect your Overlay account
          </Text>
          <Text style={[styles.helperText, { color: theme.textSecondary }]}>
            Use the same hosted account flow as web. After sign-in, Overlay returns here automatically.
          </Text>
          {authError ? <Text style={[styles.errorText, { color: '#EF4444' }]}>{authError}</Text> : null}
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            onPress={() => openAuthFlow('sign-in')}
            activeOpacity={0.82}
            style={[styles.primaryButton, { backgroundColor: theme.buttonBg }]}
          >
            <Text style={[styles.primaryButtonText, { color: theme.surface }]}>Sign in</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => openAuthFlow('sign-up')}
            activeOpacity={0.82}
            style={[styles.secondaryButton, { borderColor: theme.border }]}
          >
            <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Create account</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.inlineCallout, { backgroundColor: theme.background, borderColor: theme.border }]}>
          <Feather name="external-link" size={15} color={theme.textSecondary} />
          <Text style={[styles.inlineCalloutText, { color: theme.textSecondary }]}>
            This opens the same hosted auth flow used by the desktop app.
          </Text>
        </View>
      </View>
    )
  }

  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.userRow}>
        {user.profilePictureUrl ? (
          <Image source={{ uri: user.profilePictureUrl }} style={styles.avatarImage} alt="Profile picture" />
        ) : (
          <View style={[styles.avatarFallback, { backgroundColor: theme.background, borderColor: theme.border }]}>
            <Text style={[styles.avatarFallbackText, { color: theme.text }]}>
              {displayName.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}

        <View style={styles.userCopy}>
          <Text style={[styles.cardTitle, { color: theme.text }]} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={[styles.helperText, { color: theme.textSecondary }]} numberOfLines={1}>
            {user.email}
          </Text>
        </View>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          onPress={handleManageAccount}
          activeOpacity={0.82}
          style={[styles.secondaryButton, { borderColor: theme.border }]}
        >
          <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Manage account</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleSignOut}
          activeOpacity={0.82}
          style={[styles.secondaryButton, { borderColor: theme.border }]}
        >
          <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 24,
    padding: spacing.lg,
    gap: spacing.md,
  },
  copyBlock: {
    gap: 6,
  },
  cardTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  helperText: {
    fontSize: fontSize.sm,
    lineHeight: 19,
  },
  errorText: {
    fontSize: fontSize.sm,
    lineHeight: 19,
    marginTop: spacing.xs,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  primaryButton: {
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  secondaryButton: {
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  inlineCallout: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  inlineCalloutText: {
    flex: 1,
    fontSize: fontSize.sm,
    lineHeight: 19,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatarImage: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  avatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    fontSize: 20,
    fontWeight: '700',
  },
  userCopy: {
    flex: 1,
    gap: 2,
  },
})
