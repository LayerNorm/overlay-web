import React, { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { useTheme } from '../../hooks/useTheme'
import { useDrawer } from '../../contexts/DrawerContext'
import { useAuth } from '../../contexts/AuthContext'
import { DrawerSidebar } from '../../components/chat/DrawerSidebar'
import { ScreenWithDrawer } from '../../components/ui/ScreenWithDrawer'
import { MainScreenHeader, TopBarIconButton } from '../../components/ui/AppChrome'
import { GlassSurface } from '../../components/ui/GlassSurface'

const APPEARANCE_OPTIONS = [
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
  { label: 'Auto', value: 'auto' },
] as const

export default function SettingsScreen(): React.ReactElement {
  const router = useRouter()
  const { theme, isDark, appearanceMode, setAppearanceMode } = useTheme()
  const insets = useSafeAreaInsets()
  const { openDrawer } = useDrawer()
  const { user, signOut } = useAuth()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const displayName = useMemo(() => {
    if (!user) return 'Overlay account'
    return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email
  }, [user])

  async function handleSignOut(): Promise<void> {
    if (isSigningOut) return

    setIsSigningOut(true)
    try {
      await signOut()
      router.replace('/auth-flow?mode=sign-in&force=true')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not sign out.'
      Alert.alert('Sign out failed', message)
    } finally {
      setIsSigningOut(false)
    }
  }

  function handleOpenLegalUrl(url: string): void {
    void Linking.openURL(url)
  }

  function handleDeleteAccount(): void {
    Alert.alert(
      'Delete account',
      'This permanently deletes your Overlay account, chats, notes, knowledge, and saved memories. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue to delete',
          style: 'destructive',
          onPress: () => {
            void Linking.openURL('https://www.getoverlay.io/account?delete=1')
          },
        },
      ],
    )
  }

  return (
    <ScreenWithDrawer
      drawer={
        <DrawerSidebar
          variant="slide"
          theme={theme}
          chats={[]}
          activeChatId={null}
          onSelectChat={() => {}}
          onCreateChat={() => {}}
        />
      }
    >
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['bottom']}>
      <MainScreenHeader
        theme={theme}
        isDark={isDark}
        topInset={insets.top}
        blurHeight={insets.top + 56}
        leftSlot={<TopBarIconButton theme={theme} icon="menu" onPress={openDrawer} />}
        centerSlot={<Text style={[styles.headerTitle, { color: theme.text }]}>Settings</Text>}
        rightSlot={<View style={{ width: 44 }} />}
      />
      <View style={[styles.screenPadding, { paddingTop: insets.top + 58 }]}>
        <View style={styles.content}>
          <View style={[styles.card, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
            <View style={styles.cardHeader}>
              <View style={[styles.cardIcon, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
                <Feather name="moon" size={18} color={theme.textSecondary} />
              </View>
              <View style={styles.cardCopy}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>Appearance Mode</Text>
                <Text style={[styles.cardDescription, { color: theme.textSecondary }]}>
                  Choose a fixed theme or follow the device appearance automatically.
                </Text>
              </View>
            </View>

            <View style={[styles.segmented, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
              {APPEARANCE_OPTIONS.map((option) => {
                const active = appearanceMode === option.value
                return (
                  <TouchableOpacity
                    key={option.value}
                    activeOpacity={0.82}
                    onPress={() => {
                      void setAppearanceMode(option.value)
                    }}
                    style={[
                      styles.segment,
                      active && { backgroundColor: theme.foreground },
                    ]}
                  >
                    <Text style={[styles.segmentText, { color: active ? theme.background : theme.textSecondary }]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
            <View style={styles.cardHeader}>
              <View style={[styles.cardIcon, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
                <Feather name="user" size={18} color={theme.textSecondary} />
              </View>
              <View style={styles.cardCopy}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>Account</Text>
                <Text style={[styles.cardDescription, { color: theme.textSecondary }]}>
                  Signed in as {displayName}
                </Text>
              </View>
            </View>

            <GlassSurface interactive style={[styles.signOutButton, { backgroundColor: theme.surfaceSubtle }]}>
              <TouchableOpacity
                activeOpacity={0.82}
                onPress={() => {
                  void handleSignOut()
                }}
                style={styles.signOutButton}
              >
                {isSigningOut ? (
                  <ActivityIndicator size="small" color={theme.text} />
                ) : (
                  <>
                    <Feather name="log-out" size={16} color={theme.text} />
                    <Text style={[styles.signOutText, { color: theme.text }]}>Sign out</Text>
                  </>
                )}
              </TouchableOpacity>
            </GlassSurface>
          </View>

          <View style={[styles.card, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
            <View style={styles.cardHeader}>
              <View style={[styles.cardIcon, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
                <Feather name="shield" size={18} color={theme.textSecondary} />
              </View>
              <View style={styles.cardCopy}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>Legal & privacy</Text>
                <Text style={[styles.cardDescription, { color: theme.textSecondary }]}>
                  Review how Overlay handles your data, or permanently delete your account.
                </Text>
              </View>
            </View>

            <TouchableOpacity
              activeOpacity={0.82}
              onPress={() => handleOpenLegalUrl('https://www.getoverlay.io/privacy')}
              style={[styles.legalRow, { borderColor: theme.border }]}
            >
              <Text style={[styles.legalRowLabel, { color: theme.text }]}>Privacy policy</Text>
              <Feather name="external-link" size={16} color={theme.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.82}
              onPress={() => handleOpenLegalUrl('https://www.getoverlay.io/terms')}
              style={[styles.legalRow, { borderColor: theme.border }]}
            >
              <Text style={[styles.legalRowLabel, { color: theme.text }]}>Terms of service</Text>
              <Feather name="external-link" size={16} color={theme.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.82}
              onPress={handleDeleteAccount}
              style={[styles.legalRow, styles.legalRowDestructive, { borderColor: theme.border }]}
            >
              <Text style={[styles.legalRowLabel, styles.legalRowDestructiveLabel]}>
                Delete account
              </Text>
              <Feather name="trash-2" size={16} color="#EF4444" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

    </SafeAreaView>
    </ScreenWithDrawer>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  screenPadding: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  headerTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    textAlign: 'center',
  },
  content: {
    gap: spacing.md,
    paddingTop: spacing.lg,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xxl,
    padding: spacing.lg,
    gap: spacing.lg,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardCopy: {
    flex: 1,
    gap: 4,
  },
  cardTitle: {
    fontSize: fontSize.lg,
    lineHeight: 24,
    fontWeight: '600',
  },
  cardDescription: {
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  segmented: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.full,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  segmentText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  signOutButton: {
    minHeight: 48,
    borderRadius: borderRadius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  signOutText: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  legalRowDestructive: {
    paddingTop: 14,
  },
  legalRowLabel: {
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  legalRowDestructiveLabel: {
    color: '#EF4444',
  },
})
