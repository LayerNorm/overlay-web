import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useNetInfo } from '@react-native-community/netinfo'
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '../../contexts/AuthContext'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useTheme } from '../../hooks/useTheme'
import { mobileEntryState } from '../../lib/mobileEntryState'
import { BootScreen, OfflineBanner, WorkspaceGate } from './EntryScreens'
import { Button, T } from './primitives'

let bootCompleted = false

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { section } = useGlobalSearchParams<{ section?: string }>()
  const { theme } = useTheme()
  const { isAuthenticated, isLoading: authLoading, signOut } = useAuth()
  const workspace = useWorkspace()
  const insets = useSafeAreaInsets()
  const network = useNetInfo()
  const offline = network.isConnected === false || network.isInternetReachable === false
  const router = useRouter()
  const [boot, setBoot] = useState(!bootCompleted)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  useEffect(() => {
    if (!boot) return
    const timer = setTimeout(() => {
      bootCompleted = true
      setBoot(false)
    }, 2400)
    return () => clearTimeout(timer)
  }, [boot])
  const doSignOut = () => {
    setSignOutError(null)
    void signOut()
      .then(() => {
        router.replace('/auth-flow')
      })
      .catch(() => setSignOutError('Unable to sign out. Please try again.'))
  }
  const entry = mobileEntryState({
    boot,
    authLoading,
    authenticated: isAuthenticated,
    membershipsLoading: workspace.isLoading,
    membershipError: workspace.error,
    membershipCount: workspace.workspaces.length,
  })
  const accountAccess = isAuthenticated && pathname === '/settings' && section === 'account'
  const overlay =
    entry === 'boot' ? (
      <BootScreen theme={theme} animate={boot} />
    ) : entry === 'error' && !accountAccess ? (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          padding: 28,
          gap: 20,
          backgroundColor: theme.background,
        }}
      >
        <T style={{ color: theme.foreground }}>Unable to open your workspace.</T>
        <T style={{ color: theme.muted }}>{workspace.error}</T>
        <Button theme={theme} secondary onPress={() => void workspace.refresh()}>
          Try again
        </Button>
        <Button theme={theme} onPress={doSignOut}>
          Use another account
        </Button>
      </View>
    ) : entry === 'workspace-required' && !accountAccess ? (
      <WorkspaceGate theme={theme} onSignOut={doSignOut} onAccount={() => router.push('/settings?section=account')} />
    ) : null
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flex: 1, paddingTop: offline ? 34 : 0 }}>
        <View
          style={{ flex: 1 }}
          accessibilityElementsHidden={!!overlay}
          importantForAccessibility={overlay ? 'no-hide-descendants' : 'auto'}
        >
          {children}
        </View>
      </View>
      {overlay ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            backgroundColor: theme.background,
          }}
        >
          {overlay}
          {signOutError ? (
            <T accessibilityRole="alert" style={{ color: theme.foreground, padding: 16 }}>
              {signOutError}
            </T>
          ) : null}
        </View>
      ) : null}
      {offline ? (
        <View style={{ position: 'absolute', top: insets.top, left: 0, right: 0 }}>
          <OfflineBanner theme={theme} />
        </View>
      ) : null}
    </View>
  )
}
