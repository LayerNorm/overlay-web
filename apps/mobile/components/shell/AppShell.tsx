import React, { useEffect, useState } from 'react'
import { BackHandler, Modal, View } from 'react-native'
import { useNetInfo } from '@react-native-community/netinfo'
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '../../contexts/AuthContext'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useAppSession } from '../../contexts/AppSessionContext'
import { useDrawer } from '../../contexts/DrawerContext'
import { useTheme } from '../../hooks/useTheme'
import { useShellAgents, useShellChats } from '../../hooks/useShellData'
import { openAgentThread } from '../../services/shellService'
import { mobileEntryState } from '../../lib/mobileEntryState'
import { showShellExtensions } from '../../lib/shellNavigation'
import { AccountSheet } from './AccountSheet'
import { SidebarView, type SidebarChat } from './SidebarView'
import { BootScreen, OfflineBanner, WorkspaceGate } from './EntryScreens'
import { Button, T } from './primitives'

let bootCompleted = false

function ConnectedSidebar({ onAccount }: { onAccount: () => void }) {
  const { theme, isDark } = useTheme()
  const { user } = useAuth()
  const { activeWorkspaceId } = useWorkspace()
  const { bootstrap, isFeatureEnabled } = useAppSession()
  const { closeDrawer } = useDrawer()
  const router = useRouter()
  const pathname = usePathname()
  const [panel, setPanel] = useState<'agents' | 'chat'>(
    pathname.startsWith('/chat') ? 'chat' : 'agents',
  )
  const [scope, setScope] = useState<'personal' | 'workspace'>('workspace')
  const agents = useShellAgents(activeWorkspaceId, scope)
  const chats = useShellChats(activeWorkspaceId, scope)
  const [actionError, setActionError] = useState<string | null>(null)
  const navigate = (path: string) => {
    closeDrawer()
    router.push(path as never)
  }
  const onChat = (chat: SidebarChat) =>
    navigate(chat.kind === 'personal' ? `/chat/${chat.id}` : `/${chat.kind}/${chat.id}`)
  return (
    <SidebarView
      theme={theme}
      dark={isDark}
      panel={panel}
      scope={scope}
      onScope={setScope}
      initials={
        (user?.firstName ?? user?.email ?? '?').slice(0, 1).toUpperCase() +
        (user?.lastName?.[0] ?? '').toUpperCase()
      }
      extensions={showShellExtensions(
        bootstrap?.featureFlagRegistry,
        isFeatureEnabled('extensions'),
      )}
      agents={agents.agents}
      chats={chats.chats}
      loading={panel === 'agents' ? agents.loading : chats.loading}
      error={actionError ?? (panel === 'agents' ? agents.error : chats.error)}
      onPanel={(id) => {
        if (id === 'agents' || id === 'chat') {
          setPanel(id)
          setActionError(null)
        } else navigate(`/(tabs)/${id === 'extensions' ? 'tools' : id}`)
      }}
      onClose={closeDrawer}
      onAccount={onAccount}
      onSearch={() => navigate('/search')}
      onAdd={() => navigate(panel === 'agents' ? '/agent/new' : '/(tabs)/chat')}
      onAgent={(id, create) => {
        if (!activeWorkspaceId) return
        setActionError(null)
        void openAgentThread(activeWorkspaceId, id, create)
          .then((thread) => {
            if (thread) navigate(`/dm/${thread.conversationId}`)
          })
          .catch(() => setActionError('Unable to open this thread. Please try again.'))
      }}
      onThread={(id) => navigate(`/dm/${id}`)}
      onChat={onChat}
    />
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { section } = useGlobalSearchParams<{ section?: string }>()
  const { theme } = useTheme()
  const { user, isAuthenticated, isLoading: authLoading, signOut } = useAuth()
  const workspace = useWorkspace()
  const { drawerVisible, closeDrawer, isSidebarPermanent } = useDrawer()
  const insets = useSafeAreaInsets()
  const network = useNetInfo()
  const offline = network.isConnected === false || network.isInternetReachable === false
  const router = useRouter()
  const [boot, setBoot] = useState(!bootCompleted)
  const [account, setAccount] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  useEffect(() => {
    if (!boot) return
    const timer = setTimeout(() => {
      bootCompleted = true
      setBoot(false)
    }, 2400)
    return () => clearTimeout(timer)
  }, [boot])
  useEffect(() => {
    if (!drawerVisible && !account) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (account) setAccount(false)
      else closeDrawer()
      return true
    })
    return () => sub.remove()
  }, [account, drawerVisible, closeDrawer])
  const doSignOut = () => {
    setSignOutError(null)
    void signOut()
      .then(() => {
        setAccount(false)
        closeDrawer()
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
  const ready = isAuthenticated && entry === 'ready'
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
  const sidebar = (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        backgroundColor: theme.sidebarSurface,
      }}
    >
      <ConnectedSidebar
        onAccount={() => {
          closeDrawer()
          setAccount(true)
        }}
      />
    </View>
  )
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flex: 1, flexDirection: 'row', paddingTop: offline ? 34 : 0 }}>
        {ready && isSidebarPermanent ? <View style={{ width: 360 }}>{sidebar}</View> : null}
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
      <Modal
        visible={ready && drawerVisible && !isSidebarPermanent}
        animationType="none"
        onRequestClose={closeDrawer}
      >
        {ready ? (
          <View style={{ flex: 1, paddingTop: offline ? 34 : 0 }}>
            {sidebar}
            {offline ? (
              <View style={{ position: 'absolute', top: insets.top, left: 0, right: 0 }}>
                <OfflineBanner theme={theme} />
              </View>
            ) : null}
          </View>
        ) : null}
      </Modal>
      <Modal
        visible={ready && account}
        transparent
        animationType="slide"
        onRequestClose={() => setAccount(false)}
      >
        <AccountSheet
          theme={theme}
          bottomInset={insets.bottom}
          name={
            [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || 'Account'
          }
          email={user?.email ?? ''}
          workspaces={workspace.workspaces.map((item) => ({ id: item.id, name: item.name }))}
          activeId={workspace.activeWorkspaceId}
          switching={workspace.isSwitching}
          error={workspace.error ?? signOutError}
          onClose={() => setAccount(false)}
          onSwitch={(id) => {
            void workspace
              .switchWorkspace(id)
              .then(() => setAccount(false))
              .catch(() => undefined)
          }}
          onSettings={() => {
            setAccount(false)
            router.push('/(tabs)/settings')
          }}
          onSignOut={doSignOut}
        />
      </Modal>
    </View>
  )
}
