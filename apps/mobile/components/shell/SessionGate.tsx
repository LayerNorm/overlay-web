import React, { useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { useAuth } from '../../contexts/AuthContext'
import { useAppSession } from '../../contexts/AppSessionContext'
import { useTheme } from '../../hooks/useTheme'
import { Button, T } from './primitives'
import { WorkspaceGate } from './EntryScreens'

export function SessionGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, signOut } = useAuth()
  const { isInitialized, workspaceSetupRequired, error, refresh } = useAppSession()
  const { theme } = useTheme()
  const [signOutError, setSignOutError] = useState<string | null>(null)
  if (!isAuthenticated || isInitialized) return <>{children}</>
  if (workspaceSetupRequired) return <WorkspaceGate theme={theme} onSignOut={() => {
    void signOut().catch(() => setSignOutError('Unable to sign out. Please try again.'))
  }} />
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 28, gap: 20, backgroundColor: theme.background }}>
      {error ? <>
        <T style={{ color: theme.foreground }}>Unable to open your workspace.</T>
        <T accessibilityRole="alert" style={{ color: theme.muted }}>{error}</T>
        {signOutError ? <T style={{ color: theme.muted }}>{signOutError}</T> : null}
        <Button theme={theme} secondary onPress={() => void refresh({ forceRefresh: true })}>Try again</Button>
        <Button theme={theme} onPress={() => { void signOut().catch(() => setSignOutError('Unable to sign out. Please try again.')) }}>Use another account</Button>
      </> : <ActivityIndicator color={theme.foreground} />}
    </View>
  )
}
