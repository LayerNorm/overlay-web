import React, { useState } from 'react'
import { View } from 'react-native'
import { BatteryFull, PanelLeft, Search, Signal, Wifi } from 'lucide-react-native'
import { getTheme } from '../constants/theme'
import { AccountSheet } from '../components/shell/AccountSheet'
import {
  BootScreen,
  OfflineBanner,
  SignInScreen,
  WorkspaceGate,
} from '../components/shell/EntryScreens'
import { SidebarView, type SidebarAgent } from '../components/shell/SidebarView'
import { IconButton, T } from '../components/shell/primitives'

const agents: SidebarAgent[] = [
  {
    id: 'overlay',
    name: 'Overlay',
    isDefault: true,
    threads: [
      { conversationId: 'pricing', title: 'Review subscription pricing', status: 'working' },
      { conversationId: 'onboarding', title: 'Test the onboarding flow', status: 'working' },
      { conversationId: 'feedback', title: 'Research customer feedback', status: 'ready' },
      { conversationId: 'notes', title: 'Draft release notes', status: 'completed' },
    ],
  },
  {
    id: 'scout',
    name: 'Scout',
    avatarShape: 'cloud',
    avatarColor: '#7d9c8c',
    threads: [{ conversationId: 'scope', title: 'Confirm research scope', status: 'needs_input' }],
  },
  {
    id: 'builder',
    name: 'Builder',
    avatarShape: 'squircle',
    avatarColor: '#a28cbd',
    threads: [{ conversationId: 'beta', title: 'Build the mobile beta', status: 'working' }],
  },
]

export function ShellFixture({
  initialScreen = 'boot',
  dark = false,
  animate = false,
  error = false,
  onAction = () => undefined,
}: {
  initialScreen?: string
  dark?: boolean
  animate?: boolean
  error?: boolean
  onAction?: (name: string) => void
}) {
  const theme = getTheme(dark)
  const [screen, setScreen] = useState(initialScreen)
  const [scope, setScope] = useState<'personal' | 'workspace'>('workspace')
  const [workspace, setWorkspace] = useState('layernorm')
  const action = onAction
  const drawer = screen === 'agents-drawer' || screen === 'chats-drawer'
  return (
    <View style={{ width: 390, height: 844, backgroundColor: theme.sidebarSurface }}>
      <View
        style={{
          height: 52,
          paddingTop: 14,
          paddingHorizontal: 27,
          flexDirection: 'row',
          justifyContent: 'space-between',
        }}
      >
        <T style={{ fontSize: 14, color: theme.foreground }}>9:41</T>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Signal size={15} color={theme.foreground} />
          <Wifi size={15} color={theme.foreground} />
          <BatteryFull size={21} color={theme.foreground} />
        </View>
      </View>
      <View style={{ flex: 1 }}>
        {screen === 'boot' ? (
          <BootScreen theme={theme} animate={animate} />
        ) : screen === 'sign-in' ? (
          <SignInScreen
            theme={theme}
            error={error ? 'Unable to sign in. Please try again.' : null}
            onSignIn={() => action('Sign in')}
          />
        ) : screen === 'workspace-gate' ? (
          <WorkspaceGate theme={theme} onSignOut={() => setScreen('sign-in')} />
        ) : drawer ? (
          <SidebarView
            theme={theme}
            dark={dark}
            scope={scope}
            onScope={setScope}
            panel={screen === 'agents-drawer' ? 'agents' : 'chat'}
            agents={scope === 'workspace' ? agents : []}
            chats={
              scope === 'workspace'
                ? [
                    { id: 'launch', title: 'Launch planning', kind: 'personal' },
                    { id: 'writing', title: 'A clearer welcome email', kind: 'personal' },
                    { id: 'general', title: 'general', kind: 'channel', unread: true },
                    { id: 'product', title: 'product', kind: 'channel', unread: true },
                    { id: 'divyansh', title: 'Divyansh Lalwani', kind: 'dm' },
                  ]
                : []
            }
            initials="DL"
            onPanel={(id) => {
              if (id === 'agents' || id === 'chat')
                setScreen(id === 'agents' ? 'agents-drawer' : 'chats-drawer')
              else action(id)
            }}
            onClose={() => setScreen('main')}
            onAccount={() => setScreen('account-sheet')}
            onSearch={() => action('Search')}
            onAdd={() => action('Create')}
            onAgent={(id) => action(id)}
            onThread={(id) => action(id)}
            onChat={(chat) => action(chat.id)}
          />
        ) : (
          <View style={{ flex: 1, backgroundColor: theme.background }}>
            {screen === 'offline' ? <OfflineBanner theme={theme} /> : null}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                gap: 12,
                height: 52,
              }}
            >
              <IconButton
                theme={theme}
                icon={PanelLeft}
                label="Open navigation menu"
                onPress={() => setScreen('agents-drawer')}
              />
              <T style={{ color: theme.muted, flex: 1, fontSize: 13 }}>Workspace › Work</T>
              <IconButton
                theme={theme}
                icon={Search}
                label="Search"
                onPress={() => action('Search')}
              />
            </View>
            <T style={{ color: theme.foreground, fontSize: 25, margin: 22 }}>Work</T>
          </View>
        )}
      </View>
      <View style={{ height: 27, alignItems: 'center', justifyContent: 'center' }}>
        <View
          style={{ width: 134, height: 5, borderRadius: 9, backgroundColor: theme.foreground }}
        />
      </View>
      {screen === 'account-sheet' ? (
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}>
          <AccountSheet
            theme={theme}
            name="Divyansh Lalwani"
            email="divyansh@layernorm.com"
            workspaces={[
              { id: 'layernorm', name: 'LayerNorm', description: 'Pro workspace' },
              { id: 'personal', name: 'Personal', description: 'Your private workspace' },
            ]}
            activeId={workspace}
            onSwitch={setWorkspace}
            onClose={() => setScreen('main')}
            onSettings={() => action('Settings')}
            onSignOut={() => setScreen('sign-in')}
          />
          <View
            style={{
              height: 27,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.surfaceElevated,
            }}
          >
            <View
              style={{ width: 134, height: 5, borderRadius: 9, backgroundColor: theme.foreground }}
            />
          </View>
        </View>
      ) : null}
    </View>
  )
}
