import React, { useState } from 'react'
import { View } from 'react-native'
import { BatteryFull, Signal, Wifi } from 'lucide-react-native'
import { getTheme } from '../constants/theme'
import {
  SettingsView,
  type SettingsPage,
  type SettingsViewData,
} from '../components/settings/SettingsViews'
import { ResourcePage, ResourceSheet } from '../components/knowledge/ResourceViews'
import { AccountDeletionConfirmation, PushPrePrompt } from '../components/settings/SettingsPrompts'
import { Form, Host } from '@expo/ui/swift-ui'
import { T } from '../components/shell/primitives'
import { DEFAULT_BANNER_PREFERENCES } from '../services/bannerPreferencesService'

export const SETTINGS_FIXTURE_SCREENS = [
  'settings',
  'memories',
  'members',
  'models',
  'billing',
  'notifications',
  'voice',
  'account',
  'help',
  'push-permission',
]
export function SettingsFixture({
  initialScreen = 'settings',
  dark = false,
  empty = false,
  error = false,
  onAction = () => {},
}: {
  initialScreen?: string
  dark?: boolean
  empty?: boolean
  error?: boolean
  onAction?: (action: string) => void
}) {
  const theme = getTheme(dark)
  const [page, setPage] = useState(initialScreen as SettingsPage)
  const [banners, setBanners] = useState(DEFAULT_BANNER_PREFERENCES)
  const [permission, setPermission] = useState('Not requested')
  const [name, setName] = useState('Divyansh Lalwani')
  const [status, setStatus] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteDraft, setDeleteDraft] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const act = (action: string) => {
    setStatus(action)
    onAction(action)
  }
  const data: SettingsViewData = {
    dark,
    workspaceName: 'LayerNorm',
    canManage: true,
    appearance: dark ? 'Dark' : 'Light',
    memories: empty
      ? []
      : [
          'Keep updates concise and actionable.',
          'Use British English in customer emails.',
          'I prefer focused work in the morning.',
        ].map((content, index) => ({
          key: String(index),
          memoryId: String(index),
          segmentIndex: 0,
          content,
          fullContent: content,
          source: 'manual',
          canDelete: true,
          createdAt: 1794360000000,
        })),
    members: empty
      ? []
      : [
          {
            id: 'one',
            kind: 'member',
            name: 'Divyansh Lalwani',
            description: 'divyansh@layernorm.com',
            role: 'owner',
          },
          {
            id: 'two',
            kind: 'member',
            name: 'Anika Shah',
            description: 'anika@layernorm.com',
            role: 'member',
          },
          {
            id: 'three',
            kind: 'member',
            name: 'Alex Chen',
            description: 'alex@layernorm.com',
            role: 'member',
          },
          {
            id: 'invite',
            kind: 'invitation',
            name: 'sam@layernorm.com',
            detail: 'Invited today',
            invitationId: 'invite',
          },
        ],
    providers: empty
      ? []
      : [
          {
            _id: 'claude',
            displayName: 'Claude',
            status: 'active',
            authKind: 'subscription',
            subscriptionProvider: 'claude',
          },
          { _id: 'api', displayName: 'Anthropic', status: 'active', authKind: 'api-key' },
        ],
    defaultModel: 'Auto',
    billing: empty
      ? null
      : {
          workspaceId: 'fixture',
          canManage: true,
          canTopUp: false,
          initialized: true,
          pricingVersion: 'markup_25_v1',
          credits: {
            total: 10000,
            used: 5720,
            remaining: 4280,
            allowancePercentUsed: 57,
            topUpBalance: 0,
          },
          subscription: {
            planKind: 'paid',
            planAmountCents: 2000,
            status: 'active',
            currentPeriodEnd: 1794700800000,
          },
        },
    profile: { displayName: name, email: 'divyansh@layernorm.com' },
    bannerPreferences: banners,
    permission,
    rooms: empty
      ? []
      : [
          { id: 'product', title: '#product' },
          { id: 'general', title: '#general' },
        ],
    voiceSupported: true,
    voiceEnabled: true,
    retention: 7,
    historyCount: 4,
  }
  return (
    <View style={{ flex: 1, backgroundColor: theme.sidebarSurface }}>
      <View
        style={{
          height: 42,
          paddingHorizontal: 24,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <T style={{ color: theme.foreground, fontSize: 12, fontFamily: 'GeistMedium' }}>9:41</T>
        <View style={{ flexDirection: 'row', gap: 5 }}>
          <Signal size={13} color={theme.foreground} />
          <Wifi size={13} color={theme.foreground} />
          <BatteryFull size={17} color={theme.foreground} />
        </View>
      </View>
      <ResourcePage
        theme={theme}
        title="Settings"
        onBack={page === 'settings' ? undefined : () => setPage('settings')}
      >
        <SettingsView
          key={page}
          theme={theme}
          page={page === 'push-permission' ? 'notifications' : page}
          data={data}
          error={error ? 'Could not load settings. Try again.' : null}
          blocked={error}
          onRetry={() => act('retry')}
          actions={{
            navigate: setPage,
            memory: (row) => act(row ? 'Edit memory' : 'Add memory'),
            invite: () => act('Invite member'),
            invitation: () => act('Invitation options'),
            connection: () => act('Connect provider'),
            defaultModel: () => act('Choose model'),
            banner: (category, enabled) => {
              setBanners((value) => ({ ...value, [category]: enabled }))
              act(`${category}: ${enabled ? 'on' : 'off'}`)
            },
            room: () => act('Conversation notifications'),
            voice: () => act('Voice changed'),
            retention: () => act('Retention changed'),
            clearHistory: () => act('History cleared'),
            saveName: async (value) => {
              if (error) throw new Error('Could not save profile.')
              setName(value)
              act('Account name saved')
            },
            photo: () => act('Change photo'),
            signOut: () => act('Sign out'),
            deleteAccount: () => {
              setDeleteDraft('')
              setDeleteError(null)
              setDeleteOpen(true)
            },
            help: (kind) => act(`Help: ${kind}`),
            appearance: () => act('Appearance'),
            permission: () => {
              setPermission('Allowed · local token only')
              act('Permission requested')
            },
          }}
        />
        {status ? (
          <T
            accessibilityLabel="Fixture action"
            style={{ color: theme.muted, marginTop: 18, fontSize: 12 }}
          >
            {status}
          </T>
        ) : null}
      </ResourcePage>
      {page === 'push-permission' ? (
        <ResourceSheet
          theme={theme}
          visible
          title="Stay in the loop"
          onClose={() => setPage('notifications')}
        >
          <PushPrePrompt
            theme={theme}
            permission={permission}
            onContinue={() => {
              setPermission('Allowed · local token only')
              act('Permission requested')
            }}
            onLater={() => setPage('notifications')}
          />
        </ResourceSheet>
      ) : null}
      {deleteOpen ? (
        <ResourceSheet
          theme={theme}
          visible
          title="Delete account"
          onClose={() => setDeleteOpen(false)}
        >
          <Host style={{ height: 420 }} colorScheme={dark ? 'dark' : 'light'}>
            <Form>
          <AccountDeletionConfirmation
            confirmation={deleteDraft}
            onChange={setDeleteDraft}
            error={deleteError}
            onConfirm={() => setDeleteError('Sign in again to delete your account.')}
          />
            </Form>
          </Host>
        </ResourceSheet>
      ) : null}
    </View>
  )
}
