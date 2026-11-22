/**
 * Workspace management screen — native counterpart of web
 * `WorkspaceSettingsPanel` (`/app/settings?section=workspace`): the active
 * workspace's people/agents/teams/guests lists, invitations, sharing policy,
 * read-only billing, Slack import, and the Shared-with-me surface.
 *
 * Semantics mirror the web panel exactly: role changes for humans
 * (member/admin/guest, owner only when the caller is owner on an
 * organization workspace → transfer-ownership), member removal, invitation
 * resend/cancel, team create/manage/archive, the five policy toggles,
 * workspace archive (owner+organization), and App-Store-safe read-only
 * billing (checkout/portal stay on web).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import type {
  WorkspaceBillingSummaryResponse,
  WorkspaceManagementItem,
  WorkspaceManagementResponse,
  WorkspaceManagementView,
  WorkspaceMembershipRole,
  WorkspaceOperationalMetrics,
  WorkspaceSharingPolicy,
} from '@overlay/workspace-contracts'
import type { WorkspaceSharedResource } from '../../services/workspaceManagementService'
import { useTheme } from '../../hooks/useTheme'
import { useDrawer } from '../../contexts/DrawerContext'
import { useAppSession } from '../../contexts/AppSessionContext'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import {
  archiveWorkspace,
  archiveWorkspaceTeam,
  cancelWorkspaceInvitation,
  createWorkspaceTeam,
  exportWorkspaceAudit,
  inviteToWorkspace,
  loadManagementView,
  loadOperationalMetrics,
  loadSharedWithMe,
  loadSharingPolicy,
  loadWorkspaceBilling,
  removeWorkspaceMember,
  resendWorkspaceInvitation,
  setTeamMembership,
  updateSharingPolicy,
  updateWorkspaceMember,
} from '../../services/workspaceManagementService'
import {
  BottomSheet,
  EmptyState,
  MainScreenHeader,
  SearchField,
  TopBarIconButton,
} from '../ui/AppChrome'
import { Badge, ListRow, Section } from '../ui/primitives'
import { DrawerSidebar } from '../chat/DrawerSidebar'
import { ScreenWithDrawer } from '../ui/ScreenWithDrawer'
import { FeatureGate } from '../ui/FeatureGate'
import { SlackImportPanel } from './SlackImportPanel'

type WorkspaceTab =
  | 'people'
  | 'chats-agents'
  | 'teams'
  | 'guests'
  | 'sharing'
  | 'billing'
  | 'import'
  | 'shared'

const TABS: Array<{ value: WorkspaceTab; label: string; view?: WorkspaceManagementView }> = [
  { value: 'people', label: 'People', view: 'people' },
  { value: 'chats-agents', label: 'Agents', view: 'chats-agents' },
  { value: 'teams', label: 'Teams', view: 'teams' },
  { value: 'guests', label: 'Guests', view: 'guests' },
  { value: 'sharing', label: 'Sharing' },
  { value: 'billing', label: 'Billing' },
  { value: 'import', label: 'Import' },
  { value: 'shared', label: 'Shared' },
]

const MEMBER_ROLES: WorkspaceMembershipRole[] = ['member', 'admin', 'guest']

const POLICY_TOGGLES: Array<{
  key: 'publicLinksEnabled' | 'memberCanCreateChannels' | 'memberCanCreateAgents' | 'memberCanInvite' | 'legalHold'
  label: string
  description: string
}> = [
  {
    key: 'publicLinksEnabled',
    label: 'Public links',
    description: 'Anyone-with-the-link sharing for chats and files. Grants to people, agents, teams, and rooms are unaffected.',
  },
  {
    key: 'memberCanCreateChannels',
    label: 'Members can create channels',
    description: 'When off, only owners and admins create channels.',
  },
  {
    key: 'memberCanCreateAgents',
    label: 'Members can create agents',
    description: 'When off, only owners and admins add named agents.',
  },
  {
    key: 'memberCanInvite',
    label: 'Members can invite people',
    description: 'When on, members may send workspace invitations.',
  },
  {
    key: 'legalHold',
    label: 'Legal hold',
    description: 'While active, retention never deletes channel history.',
  },
]

const SHARED_KIND_ICONS: Record<string, React.ComponentProps<typeof Feather>['name']> = {
  conversation: 'message-circle',
  file: 'file-text',
  automation: 'zap',
  agent: 'cpu',
}

function rolloutLabel(stage?: string): string {
  switch (stage) {
    case 'dogfood':
      return 'Internal rollout'
    case 'invited':
      return 'Selected workspaces'
    default:
      return 'General'
  }
}

function kindLabel(kind: string): string {
  return kind.replace(/_/g, ' ')
}

export function WorkspaceScreen(): React.ReactElement {
  const { theme, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { openDrawer } = useDrawer()
  const { isFeatureEnabled } = useAppSession()
  const {
    activeWorkspace,
    activeWorkspaceId,
    workspacesEnabled,
    isLoading: workspaceLoading,
    refresh: refreshWorkspaces,
  } = useWorkspace()

  const [tab, setTab] = useState<WorkspaceTab>('people')
  const [state, setState] = useState<WorkspaceManagementResponse | null>(null)
  const [viewError, setViewError] = useState<string | null>(null)
  const [policy, setPolicy] = useState<{ policy: WorkspaceSharingPolicy; canManage: boolean } | null>(null)
  const [metrics, setMetrics] = useState<WorkspaceOperationalMetrics | null>(null)
  const [billing, setBilling] = useState<WorkspaceBillingSummaryResponse | null>(null)
  const [sharedItems, setSharedItems] = useState<WorkspaceSharedResource[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Sheets
  const [inviteOpen, setInviteOpen] = useState<null | { guest: boolean }>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Exclude<WorkspaceMembershipRole, 'owner'>>('member')
  const [invitePath, setInvitePath] = useState<string | null>(null)
  const [createTeamOpen, setCreateTeamOpen] = useState(false)
  const [teamName, setTeamName] = useState('')
  const [teamDescription, setTeamDescription] = useState('')
  const [manageTeam, setManageTeam] = useState<WorkspaceManagementItem | null>(null)
  const [teamCandidates, setTeamCandidates] = useState<WorkspaceManagementItem[]>([])
  const [memberAction, setMemberAction] = useState<WorkspaceManagementItem | null>(null)

  const mounted = useRef(true)
  useEffect(() => () => {
    mounted.current = false
  }, [])

  const workspaceId = activeWorkspaceId ?? ''
  const isOrganization = activeWorkspace?.kind === 'organization'
  const currentRole = state?.currentRole ?? activeWorkspace?.role ?? 'member'
  const canManage = state?.canManage === true

  // ── Tab loading ────────────────────────────────────────────────────────────

  const loadTab = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!workspaceId) return
      if (mode === 'refresh') setRefreshing(true)
      else setLoading(true)
      setViewError(null)
      try {
        const view = TABS.find((candidate) => candidate.value === tab)?.view
        if (view) {
          setState(await loadManagementView(workspaceId, view))
        } else if (tab === 'sharing') {
          const result = await loadSharingPolicy(workspaceId)
          setPolicy(result)
          setMetrics(result.canManage ? await loadOperationalMetrics(workspaceId).catch(() => null) : null)
        } else if (tab === 'billing') {
          setBilling(isOrganization ? await loadWorkspaceBilling(workspaceId) : null)
        } else if (tab === 'shared') {
          setSharedItems(await loadSharedWithMe(workspaceId))
        }
      } catch (loadError) {
        if (mounted.current) {
          setViewError(loadError instanceof Error ? loadError.message : 'Could not load this section')
        }
      } finally {
        if (mounted.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [workspaceId, tab, isOrganization],
  )

  useFocusEffect(
    useCallback(() => {
      void loadTab()
    }, [loadTab]),
  )

  const runItemAction = useCallback(
    async (itemId: string, operation: () => Promise<void>) => {
      setBusyItemId(itemId)
      setNotice(null)
      try {
        await operation()
        await loadTab('refresh')
      } catch (actionError) {
        setNotice(actionError instanceof Error ? actionError.message : 'Workspace action failed')
      } finally {
        setBusyItemId(null)
      }
    },
    [loadTab],
  )

  // ── Member actions ─────────────────────────────────────────────────────────

  const handleRolePicked = useCallback(
    (item: WorkspaceManagementItem, role: WorkspaceMembershipRole) => {
      setMemberAction(null)
      if (!item.principalId) return
      if (role === 'owner') {
        Alert.alert(
          'Transfer workspace ownership?',
          `${item.name} will become the owner. You will become an administrator.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Transfer',
              onPress: () =>
                void runItemAction(item.id, async () => {
                  await updateWorkspaceMember(workspaceId, {
                    action: 'transfer-ownership',
                    principalId: item.principalId!,
                  })
                  await refreshWorkspaces()
                }),
            },
          ],
        )
        return
      }
      void runItemAction(item.id, () =>
        updateWorkspaceMember(workspaceId, {
          action: 'set-role',
          principalId: item.principalId!,
          role,
        }),
      )
    },
    [workspaceId, runItemAction, refreshWorkspaces],
  )

  const handleRemoveMember = useCallback(
    (item: WorkspaceManagementItem) => {
      setMemberAction(null)
      Alert.alert(
        'Remove workspace member?',
        `${item.name} will immediately lose workspace access.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () =>
              void runItemAction(item.id, () =>
                removeWorkspaceMember(workspaceId, item.principalId!),
              ),
          },
        ],
      )
    },
    [workspaceId, runItemAction],
  )

  // ── Invitations ────────────────────────────────────────────────────────────

  const handleInvite = useCallback(async () => {
    const email = inviteEmail.trim()
    if (!email || busyItemId) return
    setBusyItemId('invite')
    setNotice(null)
    try {
      const response = await inviteToWorkspace(workspaceId, email, inviteRole)
      setInvitePath(response.invitePath)
      await loadTab('refresh')
    } catch (inviteError) {
      setNotice(inviteError instanceof Error ? inviteError.message : 'Could not create invitation')
    } finally {
      setBusyItemId(null)
    }
  }, [workspaceId, inviteEmail, inviteRole, busyItemId, loadTab])

  // ── Teams ──────────────────────────────────────────────────────────────────

  const openManageTeam = useCallback(
    async (item: WorkspaceManagementItem) => {
      setManageTeam(item)
      setTeamCandidates([])
      try {
        const [people, agents] = await Promise.all([
          loadManagementView(workspaceId, 'people'),
          loadManagementView(workspaceId, 'chats-agents'),
        ])
        if (mounted.current) {
          setTeamCandidates(
            [...people.items, ...agents.items].filter((candidate) => candidate.kind === 'member'),
          )
        }
      } catch {
        setNotice('Could not load team members')
      }
    },
    [workspaceId],
  )

  const toggleTeamMember = useCallback(
    async (principalId: string, member: boolean) => {
      if (!manageTeam) return
      setBusyItemId(principalId)
      try {
        await setTeamMembership(workspaceId, manageTeam.id, principalId, member)
        setManageTeam((current) => {
          if (!current) return current
          const ids = new Set(current.teamMemberPrincipalIds ?? [])
          if (member) ids.add(principalId)
          else ids.delete(principalId)
          return { ...current, teamMemberPrincipalIds: [...ids] }
        })
      } catch {
        setNotice('Could not update team')
      } finally {
        setBusyItemId(null)
      }
    },
    [workspaceId, manageTeam],
  )

  // ── Sharing policy ─────────────────────────────────────────────────────────

  const togglePolicy = useCallback(
    async (key: (typeof POLICY_TOGGLES)[number]['key'], value: boolean) => {
      if (!policy?.canManage) return
      setBusyItemId(key)
      try {
        const result = await updateSharingPolicy(workspaceId, { [key]: value })
        setPolicy(result)
      } catch {
        setNotice('Could not update workspace policy')
      } finally {
        setBusyItemId(null)
      }
    },
    [workspaceId, policy],
  )

  const handleAuditExport = useCallback(async () => {
    setBusyItemId('audit')
    try {
      const body = await exportWorkspaceAudit(workspaceId)
      const file = new File(Paths.cache, `workspace-audit-${Date.now()}.ndjson`)
      file.write(body)
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/x-ndjson' })
      } else {
        setNotice(`Audit export saved to ${file.uri}`)
      }
    } catch (exportError) {
      setNotice(exportError instanceof Error ? exportError.message : 'Audit export failed')
    } finally {
      setBusyItemId(null)
    }
  }, [workspaceId])

  // ── Archive ────────────────────────────────────────────────────────────────

  const handleArchiveWorkspace = useCallback(() => {
    Alert.alert(
      'Archive workspace?',
      `${activeWorkspace?.name ?? 'This workspace'} will stop accepting new work. Existing audit history is preserved.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: () => {
            void archiveWorkspace(workspaceId)
              .then(() => refreshWorkspaces())
              .catch(() => setNotice('Could not archive the workspace'))
          },
        },
      ],
    )
  }, [workspaceId, activeWorkspace, refreshWorkspaces])

  // ── Shared-with-me routing ─────────────────────────────────────────────────

  const openShared = useCallback(
    (item: WorkspaceSharedResource) => {
      switch (item.kind) {
        case 'conversation':
          router.push({ pathname: '/chat/[id]', params: { id: item.id } })
          break
        case 'file':
          router.push('/(tabs)/files')
          break
        case 'automation':
          router.push('/automations')
          break
        case 'agent':
          router.push({ pathname: '/agent/[id]', params: { id: item.id } })
          break
      }
    },
    [router],
  )

  // ── Render helpers ─────────────────────────────────────────────────────────

  const memberRows = (items: WorkspaceManagementItem[]) =>
    items.map((item) => {
      const busy = busyItemId === item.id
      const isSelf = item.principalId === state?.currentPrincipalId
      const accessory = busy ? (
        <ActivityIndicator size="small" color={theme.textSecondary} />
      ) : item.kind === 'invitation' && canManage ? (
        <View style={styles.rowActions}>
          <TouchableOpacity
            onPress={() =>
              void runItemAction(item.id, () =>
                resendWorkspaceInvitation(workspaceId, item.invitationId!),
              )
            }
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.actionLink, { color: theme.text }]}>Resend</Text>
          </TouchableOpacity>
          {item.status === 'pending' ? (
            <TouchableOpacity
              onPress={() =>
                void runItemAction(item.id, () =>
                  cancelWorkspaceInvitation(workspaceId, item.invitationId!),
                )
              }
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="trash-2" size={14} color={theme.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : item.kind === 'member' && item.principalType === 'human' && canManage && !isSelf ? (
        <TouchableOpacity
          onPress={() => setMemberAction(item)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="more-horizontal" size={16} color={theme.textSecondary} />
        </TouchableOpacity>
      ) : item.kind === 'team' ? (
        <View style={styles.rowActions}>
          <TouchableOpacity
            onPress={() => void openManageTeam(item)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.actionLink, { color: theme.text }]}>Manage</Text>
          </TouchableOpacity>
          {currentRole !== 'guest' ? (
            <TouchableOpacity
              onPress={() =>
                Alert.alert('Archive team?', `${item.name} will stop being available for sharing.`, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Archive',
                    style: 'destructive',
                    onPress: () =>
                      void runItemAction(item.id, () => archiveWorkspaceTeam(workspaceId, item.id)),
                  },
                ])
              }
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="archive" size={14} color={theme.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : undefined

      return (
        <ListRow
          key={item.id}
          theme={theme}
          icon={
            item.kind === 'invitation'
              ? 'mail'
              : item.kind === 'team'
                ? 'users'
                : item.principalType === 'agent'
                  ? 'cpu'
                  : 'user'
          }
          title={`${item.name}${isSelf ? ' (you)' : ''}`}
          subtitle={
            [item.description, item.role ?? (typeof item.status === 'string' ? item.status : '')]
              .filter(Boolean)
              .join(' · ') || undefined
          }
          accessory={
            <View style={styles.rowTrailing}>
              {item.badge ? <Badge theme={theme} label={item.badge} /> : null}
              {accessory}
            </View>
          }
        />
      )
    })

  const sharedTabContent = () => {
    if (sharedItems.length === 0) {
      return (
        <EmptyState
          theme={theme}
          icon="share-2"
          title="Nothing shared with you yet"
          description="Resources shared with you or your teams in this workspace appear here."
        />
      )
    }
    return (
      <Section theme={theme}>
        {sharedItems.map((item) => (
          <ListRow
            key={`${item.kind}:${item.id}`}
            theme={theme}
            icon={SHARED_KIND_ICONS[item.kind] ?? 'file'}
            title={item.title}
            subtitle={[
              kindLabel(item.kind),
              item.sharedVia ? `via ${item.sharedVia}` : '',
              item.accessRole ?? '',
              item.snippet ?? item.subtitle ?? '',
            ]
              .filter(Boolean)
              .join(' · ')}
            showChevron
            onPress={() => openShared(item)}
          />
        ))}
      </Section>
    )
  }

  const policyContent = () => {
    if (!policy) return null
    return (
      <View>
        {POLICY_TOGGLES.map((toggle) => (
          <View
            key={toggle.key}
            style={[styles.policyCard, { borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}
          >
            <View style={styles.policyBody}>
              <Text style={[styles.policyLabel, { color: theme.text }]}>{toggle.label}</Text>
              <Text style={[styles.policyDescription, { color: theme.textSecondary }]}>
                {toggle.description}
              </Text>
              <Text style={[styles.policyState, { color: theme.textDisabled }]}>
                {policy.policy[toggle.key] ? 'On' : 'Off'}
                {!policy.canManage ? ' · owners and admins only' : ''}
              </Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.8}
              disabled={!policy.canManage || busyItemId !== null}
              onPress={() => void togglePolicy(toggle.key, !policy.policy[toggle.key])}
              style={[
                styles.policyButton,
                {
                  backgroundColor: policy.policy[toggle.key] ? theme.surfaceSubtle : theme.foreground,
                  opacity: policy.canManage ? 1 : 0.45,
                },
              ]}
            >
              {busyItemId === toggle.key ? (
                <ActivityIndicator
                  size="small"
                  color={policy.policy[toggle.key] ? theme.text : theme.background}
                />
              ) : (
                <Text
                  style={[
                    styles.policyButtonText,
                    { color: policy.policy[toggle.key] ? theme.text : theme.background },
                  ]}
                >
                  {policy.policy[toggle.key] ? 'Turn off' : 'Turn on'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        ))}

        <View style={[styles.policyCard, { borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}>
          <View style={styles.policyBody}>
            <Text style={[styles.policyLabel, { color: theme.text }]}>Rollout and retention</Text>
            <Text style={[styles.policyDescription, { color: theme.textSecondary }]}>
              {`Rollout: ${rolloutLabel(policy.policy.rolloutStage)} · Guest expiry: ${
                policy.policy.guestExpirationDays ? `${policy.policy.guestExpirationDays}d` : 'none'
              } · Channel retention: ${
                policy.policy.channelRetentionDays ? `${policy.policy.channelRetentionDays}d` : 'keep all'
              }`}
            </Text>
          </View>
        </View>

        {metrics ? (
          <View style={[styles.policyCard, { borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}>
            <View style={styles.policyBody}>
              <Text style={[styles.policyLabel, { color: theme.text }]}>Operational signals</Text>
              <Text style={[styles.policyDescription, { color: theme.textSecondary }]}>
                {`Event backlog ${metrics.outboxPendingEvents} · Failed deliveries ${metrics.failedDeliveries} · Runs queued ${metrics.agentRunsQueued} · Runs failed ${metrics.agentRunsFailed} · Denials ${metrics.authorizationDenials} · Invitation failures ${metrics.invitationFailures}`}
              </Text>
            </View>
          </View>
        ) : null}

        {policy.canManage ? (
          <Section theme={theme}>
            <ListRow
              theme={theme}
              icon="download"
              title="Export audit history"
              subtitle="Newline-delimited JSON, owners and admins only"
              accessory={
                busyItemId === 'audit' ? (
                  <ActivityIndicator size="small" color={theme.textSecondary} />
                ) : undefined
              }
              onPress={() => void handleAuditExport()}
            />
          </Section>
        ) : null}
      </View>
    )
  }

  const billingContent = () => {
    if (!isOrganization) {
      return (
        <EmptyState
          theme={theme}
          icon="credit-card"
          title="Workspace billing"
          description="Billing information is available in Settings → Billing."
        />
      )
    }
    if (!billing) {
      return (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      )
    }
    const allowance = Math.min(100, Math.max(0, billing.credits.allowancePercentUsed))
    return (
      <View>
        {!billing.initialized ? (
          <View style={[styles.policyCard, { borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}>
            <View style={styles.policyBody}>
              <Text style={[styles.policyLabel, { color: theme.text }]}>Workspace wallet not set up</Text>
              <Text style={[styles.policyDescription, { color: theme.textSecondary }]}>
                Shared agents, files, automations, and hosted work draw on this wallet. Wallets are
                not initialized.
              </Text>
            </View>
          </View>
        ) : (
          <>
            <View style={[styles.policyCard, { borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}>
              <View style={styles.policyBody}>
                <Text style={[styles.policyLabel, { color: theme.text }]}>Workspace credits</Text>
                <Text style={[styles.policyDescription, { color: theme.textSecondary }]}>
                  {`${Math.round(billing.credits.remaining)} remaining · ${Math.round(billing.credits.used)} used this period · ${Math.round(billing.credits.topUpBalance)} top-up`}
                </Text>
                <View style={[styles.meterTrack, { backgroundColor: theme.surfaceSubtle }]}>
                  <View style={[styles.meterFill, { backgroundColor: theme.foreground, width: `${allowance}%` }]} />
                </View>
                <Text style={[styles.policyState, { color: theme.textDisabled }]}>
                  {allowance.toFixed(0)}% allowance used
                </Text>
              </View>
            </View>
            <View style={[styles.policyCard, { borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}>
              <View style={styles.policyBody}>
                <Text style={[styles.policyLabel, { color: theme.text }]}>
                  {billing.subscription.planKind === 'paid'
                    ? `$${billing.subscription.planAmountCents / 100}/month`
                    : 'No subscription'}
                </Text>
                <Text style={[styles.policyDescription, { color: theme.textSecondary }]}>
                  {`One workspace wallet. Unlimited members.${
                    billing.subscription.status ? ` Status: ${billing.subscription.status}.` : ''
                  }`}
                </Text>
                <Text style={[styles.policyState, { color: theme.textDisabled }]}>
                  Billing is read-only in this app.
                </Text>
              </View>
            </View>
          </>
        )}
      </View>
    )
  }

  const tabContent = () => {
    if (tab === 'sharing') return policyContent()
    if (tab === 'billing') return billingContent()
    if (tab === 'import') return <SlackImportPanel theme={theme} />
    if (tab === 'shared') return sharedTabContent()

    if (loading && !state) {
      return (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      )
    }
    if (viewError) {
      return (
        <EmptyState
          theme={theme}
          icon="alert-circle"
          title={`Could not load ${TABS.find((t) => t.value === tab)?.label.toLowerCase()}`}
          description={viewError}
        />
      )
    }
    const items = state?.items ?? []
    if (items.length === 0) {
      const empty: Record<string, [string, string]> = {
        people: ['No other people yet', 'Invite teammates to collaborate in chats and on shared resources.'],
        'chats-agents': ['No shared agents', 'Named agents for this workspace are managed from the Agents page.'],
        teams: ['No teams yet', 'Group people and agents so access can be managed together.'],
        guests: ['No guests', 'Guests only see the chats and resources explicitly shared with them.'],
      }
      const [title, description] = empty[tab] ?? ['Nothing here', '']
      return <EmptyState theme={theme} icon="users" title={title} description={description} />
    }
    return (
      <View>
        <Section theme={theme}>{memberRows(items)}</Section>
        {tab === 'chats-agents' ? (
          <Text style={[styles.footerHint, { color: theme.textDisabled }]}>
            Personal chats stay private; shared rooms and named agents belong to this workspace.
          </Text>
        ) : null}
      </View>
    )
  }

  const primaryAction = () => {
    if (tab === 'people' && canManage)
      return () => {
        setInviteRole('member')
        setInviteOpen({ guest: false })
      }
    if (tab === 'guests' && canManage)
      return () => {
        setInviteRole('guest')
        setInviteOpen({ guest: true })
      }
    if (tab === 'teams' && currentRole !== 'guest') return () => setCreateTeamOpen(true)
    return null
  }

  if (!isFeatureEnabled('workspaces') && !workspacesEnabled) {
    return <FeatureGate title="Workspaces are turned off" />
  }

  const headerPrimary = primaryAction()

  return (
    <ScreenWithDrawer
      drawer={
        <DrawerSidebar
          variant="slide"
          theme={theme}
          chats={[]}
          activeChatId={null}
          onSelectChat={(chatId) => router.push({ pathname: '/chat/[id]', params: { id: chatId } })}
          onCreateChat={() => router.push('/chat')}
        />
      }
    >
      <View style={[styles.screen, { backgroundColor: theme.background }]}>
        <MainScreenHeader
          theme={theme}
          isDark={isDark}
          topInset={insets.top}
          blurHeight={insets.top + 58}
          leftSlot={<TopBarIconButton theme={theme} icon="menu" onPress={openDrawer} />}
          centerSlot={
            <View style={styles.headerCenter}>
              <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
                {activeWorkspace?.name ?? 'Workspace'}
              </Text>
              <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
                {`${activeWorkspace?.kind === 'organization' ? 'Organization' : 'Personal'}${
                  activeWorkspace?.memberCount ? ` · ${activeWorkspace.memberCount} members` : ''
                }${activeWorkspace?.role ? ` · ${activeWorkspace.role}` : ''}`}
              </Text>
            </View>
          }
          rightSlot={
            <View style={styles.headerActions}>
              {isOrganization && activeWorkspace?.role === 'owner' ? (
                <TopBarIconButton theme={theme} icon="archive" onPress={handleArchiveWorkspace} />
              ) : null}
              {headerPrimary ? (
                <TopBarIconButton theme={theme} icon="plus" onPress={headerPrimary} />
              ) : null}
            </View>
          }
        />

        <ScrollView
          style={styles.body}
          contentContainerStyle={[styles.bodyContent, { paddingBottom: insets.bottom + spacing.xl }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadTab('refresh')}
              tintColor={theme.textSecondary}
            />
          }
        >
          {/* Tab chips — horizontal scroll, mirrors the web settings tab bar. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabsRow}
            contentContainerStyle={styles.tabsContent}
          >
            {TABS.map((candidate) => {
              const active = tab === candidate.value
              return (
                <TouchableOpacity
                  key={candidate.value}
                  activeOpacity={0.7}
                  onPress={() => setTab(candidate.value)}
                  style={[
                    styles.tabChip,
                    {
                      backgroundColor: active ? theme.surfaceSubtle : 'transparent',
                      borderColor: active ? theme.border : 'transparent',
                    },
                  ]}
                >
                  <Text style={[styles.tabChipText, { color: active ? theme.text : theme.textSecondary }]}>
                    {candidate.label}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </ScrollView>

          {notice ? <Text style={[styles.notice, { color: '#EF4444' }]}>{notice}</Text> : null}
          {tabContent()}
        </ScrollView>

        {/* Member action sheet */}
        <BottomSheet
          theme={theme}
          visible={memberAction !== null}
          onClose={() => setMemberAction(null)}
          title={memberAction?.name ?? 'Member'}
        >
          <Section theme={theme}>
            {MEMBER_ROLES.map((role) => (
              <ListRow
                key={role}
                theme={theme}
                icon="shield"
                title={`Make ${role}`}
                selected={memberAction?.role === role}
                onPress={() => memberAction && handleRolePicked(memberAction, role)}
              />
            ))}
            {currentRole === 'owner' && isOrganization ? (
              <ListRow
                theme={theme}
                icon="key"
                title="Transfer ownership"
                subtitle="They become owner; you become admin"
                onPress={() => memberAction && handleRolePicked(memberAction, 'owner')}
              />
            ) : null}
          </Section>
          <Section theme={theme}>
            <ListRow
              theme={theme}
              icon="trash-2"
              title="Remove from workspace"
              destructive
              onPress={() => memberAction && handleRemoveMember(memberAction)}
            />
          </Section>
        </BottomSheet>

        {/* Invite sheet */}
        <BottomSheet
          theme={theme}
          visible={inviteOpen !== null}
          onClose={() => {
            setInviteOpen(null)
            setInvitePath(null)
            setInviteEmail('')
          }}
          title={inviteOpen?.guest ? 'Invite guest' : 'Invite people'}
        >
          {invitePath ? (
            <View style={styles.inviteDone}>
              <Feather name="check-circle" size={22} color={theme.textSecondary} />
              <Text style={[styles.inviteDoneText, { color: theme.text }]}>Invitation sent</Text>
              <Text style={[styles.invitePath, { color: theme.textSecondary }]} selectable>
                {invitePath}
              </Text>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => void Clipboard.setStringAsync(invitePath)}
                style={[styles.submitButton, { backgroundColor: theme.foreground }]}
              >
                <Text style={[styles.submitText, { color: theme.background }]}>Copy invite link</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.inviteForm}>
              <TextInput
                value={inviteEmail}
                onChangeText={setInviteEmail}
                placeholder="name@example.com"
                placeholderTextColor={theme.textDisabled}
                autoCapitalize="none"
                keyboardType="email-address"
                style={[
                  styles.inviteInput,
                  { color: theme.text, backgroundColor: theme.surfaceSubtle, borderColor: theme.border },
                ]}
              />
              <View style={styles.roleChipsRow}>
                {(inviteOpen?.guest ? (['guest'] as const) : MEMBER_ROLES).map((role) => {
                  const active = inviteRole === role
                  return (
                    <TouchableOpacity
                      key={role}
                      activeOpacity={0.7}
                      onPress={() => setInviteRole(role as Exclude<WorkspaceMembershipRole, 'owner'>)}
                      style={[
                        styles.tabChip,
                        {
                          backgroundColor: active ? theme.surfaceSubtle : 'transparent',
                          borderColor: active ? theme.border : 'transparent',
                        },
                      ]}
                    >
                      <Text style={[styles.tabChipText, { color: active ? theme.text : theme.textSecondary }]}>
                        {role}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
              <TouchableOpacity
                activeOpacity={0.85}
                disabled={busyItemId !== null || !inviteEmail.trim()}
                onPress={() => void handleInvite()}
                style={[
                  styles.submitButton,
                  { backgroundColor: theme.foreground, opacity: inviteEmail.trim() ? 1 : 0.45 },
                ]}
              >
                {busyItemId === 'invite' ? (
                  <ActivityIndicator size="small" color={theme.background} />
                ) : (
                  <Text style={[styles.submitText, { color: theme.background }]}>Send invitation</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </BottomSheet>

        {/* Create team sheet */}
        <BottomSheet
          theme={theme}
          visible={createTeamOpen}
          onClose={() => setCreateTeamOpen(false)}
          title="New team"
        >
          <View style={styles.inviteForm}>
            <TextInput
              value={teamName}
              onChangeText={setTeamName}
              placeholder="Team name"
              placeholderTextColor={theme.textDisabled}
              style={[
                styles.inviteInput,
                { color: theme.text, backgroundColor: theme.surfaceSubtle, borderColor: theme.border },
              ]}
            />
            <TextInput
              value={teamDescription}
              onChangeText={setTeamDescription}
              placeholder="Description (optional)"
              placeholderTextColor={theme.textDisabled}
              style={[
                styles.inviteInput,
                { color: theme.text, backgroundColor: theme.surfaceSubtle, borderColor: theme.border },
              ]}
            />
            <TouchableOpacity
              activeOpacity={0.85}
              disabled={busyItemId !== null || !teamName.trim()}
              onPress={() => {
                void runItemAction('create-team', () =>
                  createWorkspaceTeam(workspaceId, teamName.trim(), teamDescription.trim() || undefined),
                ).then(() => {
                  setCreateTeamOpen(false)
                  setTeamName('')
                  setTeamDescription('')
                })
              }}
              style={[
                styles.submitButton,
                { backgroundColor: theme.foreground, opacity: teamName.trim() ? 1 : 0.45 },
              ]}
            >
              {busyItemId === 'create-team' ? (
                <ActivityIndicator size="small" color={theme.background} />
              ) : (
                <Text style={[styles.submitText, { color: theme.background }]}>Create team</Text>
              )}
            </TouchableOpacity>
          </View>
        </BottomSheet>

        {/* Team members sheet */}
        <BottomSheet
          theme={theme}
          visible={manageTeam !== null}
          onClose={() => setManageTeam(null)}
          title={manageTeam ? `${manageTeam.name} members` : 'Team members'}
        >
          {teamCandidates.length === 0 ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={theme.textSecondary} />
            </View>
          ) : (
            <Section theme={theme}>
              {teamCandidates.map((candidate) => {
                const member = (manageTeam?.teamMemberPrincipalIds ?? []).includes(
                  candidate.principalId ?? '',
                )
                return (
                  <ListRow
                    key={candidate.principalId ?? candidate.id}
                    theme={theme}
                    icon={candidate.principalType === 'agent' ? 'cpu' : 'user'}
                    title={candidate.name}
                    subtitle={candidate.description}
                    selected={member}
                    accessory={
                      busyItemId === candidate.principalId ? (
                        <ActivityIndicator size="small" color={theme.textSecondary} />
                      ) : undefined
                    }
                    onPress={() =>
                      candidate.principalId && void toggleTeamMember(candidate.principalId, !member)
                    }
                  />
                )
              })}
            </Section>
          )}
        </BottomSheet>
      </View>
    </ScreenWithDrawer>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: spacing.md, paddingTop: 62 },
  headerCenter: { alignItems: 'center', gap: 1, maxWidth: 230 },
  headerTitle: { fontSize: fontSize.md, fontWeight: '700' },
  headerSubtitle: { fontSize: 11 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tabsRow: { flexGrow: 0, marginBottom: spacing.sm },
  tabsContent: { gap: 6, paddingRight: spacing.md },
  tabChip: {
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  tabChipText: { fontSize: fontSize.xs, fontWeight: '600' },
  notice: { fontSize: fontSize.sm, paddingVertical: spacing.xs },
  loadingWrap: { alignItems: 'center', paddingVertical: spacing.xl },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  rowTrailing: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionLink: { fontSize: fontSize.sm, fontWeight: '600' },
  footerHint: { fontSize: 11, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  policyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  policyBody: { flex: 1, gap: 3 },
  policyLabel: { fontSize: fontSize.sm, fontWeight: '600' },
  policyDescription: { fontSize: fontSize.xs, lineHeight: 16 },
  policyState: { fontSize: 11 },
  policyButton: {
    borderRadius: borderRadius.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 78,
    alignItems: 'center',
  },
  policyButtonText: { fontSize: fontSize.xs, fontWeight: '700' },
  meterTrack: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 6 },
  meterFill: { height: 6, borderRadius: 3 },
  inviteForm: { gap: spacing.sm },
  inviteInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    fontSize: fontSize.md,
  },
  roleChipsRow: { flexDirection: 'row', gap: 6 },
  inviteDone: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  inviteDoneText: { fontSize: fontSize.md, fontWeight: '700' },
  invitePath: { fontSize: fontSize.xs, textAlign: 'center' },
  submitButton: {
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs,
    alignSelf: 'stretch',
  },
  submitText: { fontSize: fontSize.sm, fontWeight: '700' },
})
