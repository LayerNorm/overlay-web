import React, { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { useTheme } from '../../hooks/useTheme'
import { useDrawer } from '../../contexts/DrawerContext'
import { useAuth } from '../../contexts/AuthContext'
import { DrawerSidebar } from '../../components/chat/DrawerSidebar'
import { ScreenWithDrawer } from '../../components/ui/ScreenWithDrawer'
import { TopBarIconButton } from '../../components/ui/AppChrome'
import { GlassSurface } from '../../components/ui/GlassSurface'

const APPEARANCE_OPTIONS = [
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
  { label: 'Auto', value: 'auto' },
] as const

export default function SettingsScreen(): React.ReactElement {
  const router = useRouter()
  const { theme, appearanceMode, setAppearanceMode } = useTheme()
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
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.screenPadding}>
        <View style={[styles.topBar, { backgroundColor: theme.background }]}>
          <TopBarIconButton theme={theme} icon="menu" onPress={openDrawer} />
          <Text style={[styles.topBarTitle, { color: theme.text }]}>Settings</Text>
          <View style={styles.topBarSpacer} />
        </View>

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
  topBar: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    overflow: 'hidden',
  },
  topBarTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
    fontFamily: 'LibreBaskerville',
  },
  topBarSpacer: {
    width: 38,
    height: 38,
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
    borderWidth: StyleSheet.hairlineWidth,
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
})
