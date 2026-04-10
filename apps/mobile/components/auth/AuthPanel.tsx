import React, { useCallback } from 'react'
import {
  ActivityIndicator,
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { useTheme } from '../../hooks/useTheme'
import { useAuth } from '../../contexts/AuthContext'
import { getAccountUrl } from '../../services/authService'

interface AuthPanelProps {
  context?: 'onboarding' | 'settings'
  onSignedOut?: () => void
}

function TierBadge({ tier }: { tier: 'free' | 'pro' | 'max' }): React.ReactElement {
  const { theme } = useTheme()

  return (
    <View style={[styles.tierBadge, { backgroundColor: theme.background, borderColor: theme.border }]}>
      <Text style={[styles.tierBadgeText, { color: theme.text }]}>
        {tier === 'free' ? 'Free' : tier === 'pro' ? 'Pro' : 'Max'}
      </Text>
    </View>
  )
}

export function AuthPanel({
  context = 'settings',
  onSignedOut
}: AuthPanelProps): React.ReactElement {
  const router = useRouter()
  const { theme } = useTheme()
  const { user, entitlements, isLoading, isAuthenticated, authError, signOut } = useAuth()

  const openAuthFlow = useCallback(
    (mode: 'sign-in' | 'sign-up') => {
      router.push({
        pathname: '/auth-flow',
        params: {
          mode,
          force: mode === 'sign-in' ? 'true' : 'false',
          startAtAuth: context === 'onboarding' ? 'true' : 'false'
        }
      })
    },
    [context, router]
  )

  const handleManageAccount = useCallback(() => {
    Linking.openURL(getAccountUrl())
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
          Restoring your account session…
        </Text>
      </View>
    )
  }

  if (!isAuthenticated || !user) {
    return (
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.copyBlock}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>
            {context === 'onboarding' ? 'Sign in to continue' : 'Connect your Overlay account'}
          </Text>
          <Text style={[styles.helperText, { color: theme.textSecondary }]}>
            {context === 'onboarding'
              ? 'Use the same landing-page auth flow as desktop. After sign-in, Overlay returns here automatically.'
              : 'Sign in with the landing auth flow to sync your Overlay account, plan, and Convex-backed profile.'}
          </Text>
          {authError ? (
            <Text style={[styles.errorText, { color: '#EF4444' }]}>{authError}</Text>
          ) : null}
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

  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.userRow}>
        {user.profilePictureUrl ? (
          <Image source={{ uri: user.profilePictureUrl }} style={styles.avatarImage} />
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

        <TierBadge tier={entitlements?.tier || 'free'} />
      </View>

      <View style={styles.metricRow}>
        <View style={[styles.metricCard, { backgroundColor: theme.background, borderColor: theme.border }]}>
          <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Credits</Text>
          <Text style={[styles.metricValue, { color: theme.text }]}>
            {entitlements ? `${entitlements.creditsUsed} / ${entitlements.creditsTotal}` : 'Synced'}
          </Text>
        </View>
        <View style={[styles.metricCard, { backgroundColor: theme.background, borderColor: theme.border }]}>
          <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Plan</Text>
          <Text style={[styles.metricValue, { color: theme.text }]}>
            {entitlements?.tier ? entitlements.tier.toUpperCase() : 'Overlay'}
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
    gap: spacing.md
  },
  copyBlock: {
    gap: 6
  },
  cardTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700'
  },
  helperText: {
    fontSize: fontSize.sm,
    lineHeight: 19
  },
  errorText: {
    fontSize: fontSize.sm,
    lineHeight: 19,
    marginTop: spacing.xs
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap'
  },
  primaryButton: {
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center'
  },
  primaryButtonText: {
    fontSize: fontSize.md,
    fontWeight: '700'
  },
  secondaryButton: {
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  secondaryButtonText: {
    fontSize: fontSize.md,
    fontWeight: '600'
  },
  inlineCallout: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm
  },
  inlineCalloutText: {
    flex: 1,
    fontSize: fontSize.sm,
    lineHeight: 19
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md
  },
  avatarImage: {
    width: 52,
    height: 52,
    borderRadius: 26
  },
  avatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarFallbackText: {
    fontSize: 20,
    fontWeight: '700'
  },
  userCopy: {
    flex: 1,
    gap: 2
  },
  tierBadge: {
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingVertical: 6,
    paddingHorizontal: 10
  },
  tierBadgeText: {
    fontSize: 12,
    fontWeight: '700'
  },
  metricRow: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  metricCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: 4
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4
  },
  metricValue: {
    fontSize: fontSize.lg,
    fontWeight: '700'
  }
})
