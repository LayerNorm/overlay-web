'use client'

import React from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  Archive,
  Bot,
  CircleAlert,
  Download,
  KeyRound,
  Link2,
  Loader2,
  MessageSquareText,
  RefreshCw,
  RotateCw,
  Shield,
  Trash2,
  UserPlus,
  Users,
  UsersRound,
  WalletCards,
} from 'lucide-react'
import {
  Button,
  EmptyState,
  Select,
  TabButton,
  TabsList,
} from '@overlay/ui/primitives'
import type {
  WorkspaceManagementItem,
  WorkspaceManagementResponse,
  WorkspaceMembershipRole,
  WorkspaceOperationalMetrics,
  WorkspaceRolloutStage,
  WorkspaceSummary,
} from '@overlay/workspace-contracts'
import { describeRolloutStage } from '@/shared/workspaces/collaboration-rollout'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { workspaceManagementClient } from '../lib/workspace-client'
import { WORKSPACE_SETTINGS_TABS as TABS, isWorkspaceSettingsTab } from '../lib/workspace-settings-tabs'
import type {
  WorkspaceLifecycleStatus,
  WorkspaceManagementClient,
  WorkspaceSettingsTab,
} from '@/shared/workspaces/types'
import { WorkspaceAvatar } from './WorkspaceAvatar'
import { WorkspaceNameEditor } from './WorkspaceNameEditor'
import {
  ConfirmWorkspaceActionDialog,
  CreateTeamDialog,
  InviteWorkspaceDialog,
  TeamMembersDialog,
} from './WorkspaceManagementDialogs'
import { WorkspaceBillingSection } from './WorkspaceBillingSection'
import { ImportPanel } from './ImportPanel'
import { invalidateWorkspaceScopePolicy } from '@/hooks/use-workspace-create-access'

export type WorkspaceManagementState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | ({ status: 'ready' } & WorkspaceManagementResponse)


function WorkspaceSettingsTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: WorkspaceSettingsTab
  onTabChange(tab: WorkspaceSettingsTab): void
}) {
  return (
    <div className="overflow-x-auto border-b border-[var(--border)] px-5">
      <TabsList className="min-w-max gap-1 rounded-none bg-transparent p-0" aria-label="Workspace settings">
        {TABS.filter((tab) => tab.id !== 'teams').map((tab) => {
          const Icon = tab.icon
          return (
            <TabButton
              key={tab.id}
              active={activeTab === tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`relative h-11 gap-1.5 rounded-none bg-transparent px-2.5 shadow-none ${
                activeTab === tab.id
                  ? 'after:absolute after:inset-x-1 after:bottom-0 after:h-px after:bg-[var(--foreground)]'
                  : ''
              }`}
            >
              <Icon size={13} />
              {tab.label}
            </TabButton>
          )
        })}
      </TabsList>
    </div>
  )
}

export function WorkspaceManagementContent({
  tab,
  state,
  onRetry,
  onPrimaryAction,
  onMemberRoleChange,
  onRemoveMember,
  onInvitationAction,
  onManageTeam,
  onArchiveTeam,
  busyItemId,
}: {
  tab: WorkspaceSettingsTab
  state: WorkspaceManagementState
  onRetry?(): void
  onPrimaryAction?(): void
  onMemberRoleChange?(item: WorkspaceManagementItem, role: WorkspaceMembershipRole): void
  onRemoveMember?(item: WorkspaceManagementItem): void
  onInvitationAction?(item: WorkspaceManagementItem, action: 'cancel' | 'resend'): void
  onManageTeam?(item: WorkspaceManagementItem): void
  onArchiveTeam?(item: WorkspaceManagementItem): void
  busyItemId?: string | null
}) {
  const config = TABS.find((candidate) => candidate.id === tab) ?? TABS[0]!
  const Icon = config.icon

  if (state.status === 'loading') {
    return (
      <div className="space-y-3 p-5" aria-label={`Loading ${config.label.toLowerCase()}`}>
        {[0, 1, 2].map((item) => (
          <div key={item} className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3">
            <span className="h-9 w-9 animate-pulse rounded-lg bg-[var(--surface-subtle)]" />
            <span className="h-3 w-2/5 animate-pulse rounded bg-[var(--surface-subtle)]" />
          </div>
        ))}
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <EmptyState
        data-testid="workspace-management-error"
        className="min-h-72 px-6 py-12"
        icon={<CircleAlert size={28} />}
        title={`Could not load ${config.label.toLowerCase()}`}
        description={state.message}
        action={(
          <Button size="sm" onClick={onRetry}>
            <RefreshCw size={12} />
            Try again
          </Button>
        )}
      />
    )
  }

  if (state.items.length === 0) {
    const actionEnabled = Boolean(
      onPrimaryAction
      && (
        (tab === 'teams' && state.currentRole !== 'guest')
        || ((tab === 'people' || tab === 'guests') && state.canManage)
      ),
    )
    return (
      <EmptyState
        data-testid="workspace-management-empty"
        className="min-h-72 px-6 py-12"
        icon={<Icon size={30} strokeWidth={1.5} />}
        title={config.emptyTitle}
        description={config.emptyDescription}
        action={(
          <Button
            size="sm"
            disabled={!actionEnabled}
            onClick={actionEnabled ? onPrimaryAction : undefined}
            title={actionEnabled ? undefined : unavailableActionTitle(tab)}
          >
            {config.action}
          </Button>
        )}
      />
    )
  }

  return (
    <div data-testid="workspace-management-list">
      <div className="divide-y divide-[var(--border)]">
        {state.items.map((item) => {
          const busy = busyItemId === item.id
          return (
            <div key={item.id} className="flex min-h-16 items-center gap-3 px-5 py-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--muted)]">
                <Icon size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-[var(--foreground)]">{item.name}</span>
                  {item.badge ? (
                    <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--muted)]">
                      {item.badge}
                    </span>
                  ) : null}
                </span>
                {item.description ? (
                  <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">{item.description}</span>
                ) : null}
              </span>
              {item.detail && item.kind !== 'member' && item.kind !== 'invitation' ? (
                <span className="shrink-0 text-xs text-[var(--muted-light)]">{item.detail}</span>
              ) : null}
              {busy ? <Loader2 size={14} className="animate-spin text-[var(--muted)]" /> : (
                <WorkspaceItemActions
                  item={item}
                  state={state}
                  onMemberRoleChange={onMemberRoleChange}
                  onRemoveMember={onRemoveMember}
                  onInvitationAction={onInvitationAction}
                  onManageTeam={onManageTeam}
                  onArchiveTeam={onArchiveTeam}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export type WorkspaceSharingPolicyState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
    status: 'ready'
    canManage: boolean
    updatedAt: number
    publicLinksEnabled: boolean
    memberCanCreateChannels: boolean
    memberCanCreateAgents: boolean
    memberCanInvite: boolean
    /** True when anyone in the workspace (not only admins) may create or edit workspace-scoped skills, MCP servers, and connectors. */
    membersCanEditExtensions: boolean
    /** True when anyone in the workspace may create or edit workspace-scoped notes, files, outputs, and automations. */
    membersCanEditContent: boolean
    memberCanMoveScope: boolean
    /** True when anyone in the workspace (not only admins) may add usage. */
    membersCanTopUp: boolean
    legalHold: boolean
    rolloutStage: WorkspaceRolloutStage
    guestExpirationDays?: number
    channelRetentionDays?: number
    metrics?: WorkspaceOperationalMetrics
  }

type PolicyToggleKey =
  | 'publicLinksEnabled'
  | 'memberCanCreateChannels'
  | 'memberCanCreateAgents'
  | 'memberCanInvite'
  | 'membersCanEditExtensions'
  | 'membersCanEditContent'
  | 'memberCanMoveScope'
  | 'membersCanTopUp'
  | 'legalHold'

/** The policy patch for a toggle: most are plain booleans, the "who may" ones are `members` or `admins`. */
function policyPatchFor(key: PolicyToggleKey, value: boolean): Record<string, unknown> {
  const editors = value ? 'members' : 'admins'
  if (key === 'membersCanEditExtensions') return { workspaceExtensionsEditors: editors }
  if (key === 'membersCanEditContent') return { workspaceContentEditors: editors }
  if (key === 'membersCanTopUp') return { usageTopUpBy: editors }
  return { [key]: value }
}

const POLICY_TOGGLES: ReadonlyArray<{
  key: PolicyToggleKey
  label: string
  description: string
  onLabel: string
  offLabel: string
}> = [
  {
    key: 'publicLinksEnabled',
    label: 'Public links',
    description: 'Anyone-with-the-link sharing for chats and files. Public views stay read-only and redact attachments that are not public themselves. Turning this off does not remove access granted to people, agents, teams, or rooms.',
    onLabel: 'Allowed for this workspace',
    offLabel: 'Blocked for this workspace',
  },
  {
    key: 'memberCanCreateChannels',
    label: 'Members can create channels',
    description: 'When off, only owners and admins create channels. Existing channels are unaffected.',
    onLabel: 'Members may create channels',
    offLabel: 'Owners and admins only',
  },
  {
    key: 'memberCanCreateAgents',
    label: 'Members can create agents',
    description: 'When off, only owners and admins add named agents to this workspace.',
    onLabel: 'Members may create agents',
    offLabel: 'Owners and admins only',
  },
  {
    key: 'memberCanInvite',
    label: 'Members can invite people',
    description: 'When on, members may send workspace invitations. Owners and admins always may.',
    onLabel: 'Members may invite',
    offLabel: 'Owners and admins only',
  },
  {
    key: 'membersCanEditExtensions',
    label: 'Anyone can share skills, MCP servers, and connectors',
    description: 'When off, only owners and admins create or edit workspace-scoped skills, MCP servers, and connectors (they hold credentials or run code). Personal ones stay with their creator.',
    onLabel: 'Anyone in the workspace',
    offLabel: 'Owners and admins only',
  },
  {
    key: 'membersCanEditContent',
    label: 'Anyone can share notes, files, outputs, and automations',
    description: 'When off, only owners and admins create or edit workspace-scoped notes, files, outputs, and automations.',
    onLabel: 'Anyone in the workspace',
    offLabel: 'Owners and admins only',
  },
  {
    key: 'memberCanMoveScope',
    label: 'Members can move their own items between Personal and Workspace',
    description: 'When off, members cannot move items between scopes; owners and admins still can for items they created. Nobody moves someone else’s item.',
    onLabel: 'Members may move their own items',
    offLabel: 'Owners and admins only',
  },
  {
    key: 'membersCanTopUp',
    label: 'Anyone can add usage to the workspace',
    description: 'When off, only owners and admins add usage (top-ups) to this workspace.',
    onLabel: 'Anyone in the workspace',
    offLabel: 'Owners and admins only',
  },
  {
    key: 'legalHold',
    label: 'Legal hold',
    description: 'While a hold is active, retention never deletes channel history, even when a retention window is set.',
    onLabel: 'Hold active — nothing is swept',
    offLabel: 'No hold',
  },
]

/**
 * Workspace policy for General access. Public links are not collaborator
 * grants, so they are governed here rather than per resource.
 */
export function WorkspaceSharingPolicySection({
  state,
  busy = false,
  onToggle,
  onRetry,
}: {
  state: WorkspaceSharingPolicyState
  busy?: boolean
  onToggle?(key: PolicyToggleKey, value: boolean): void
  onRetry?(): void
}) {
  if (state.status === 'loading') {
    return (
      <div className="space-y-3 p-5" aria-label="Loading sharing & links">
        <div className="h-16 animate-pulse rounded-xl bg-[var(--surface-subtle)]" />
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <EmptyState
        data-testid="workspace-sharing-policy-error"
        className="min-h-72 px-6 py-12"
        icon={<CircleAlert size={28} />}
        title="Could not load sharing & links"
        description={state.message}
        action={<Button size="sm" onClick={onRetry}><RefreshCw size={12} />Try again</Button>}
      />
    )
  }

  return (
    <div data-testid="workspace-sharing-policy" className="space-y-3 p-5">
      {POLICY_TOGGLES.map((toggle) => (
        <div key={toggle.key} className="flex items-start gap-3 rounded-xl border border-[var(--border)] p-4">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--muted)]">
            <Link2 size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[var(--foreground)]">{toggle.label}</p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{toggle.description}</p>
            <p className="mt-2 text-[11px] text-[var(--muted-light)]">
              {state[toggle.key] ? toggle.onLabel : toggle.offLabel}
            </p>
          </div>
          <Button
            size="sm"
            variant={state[toggle.key] ? 'ghost' : 'primary'}
            disabled={!state.canManage || busy}
            title={state.canManage ? undefined : 'Only owners and admins can change workspace policy'}
            onClick={state.canManage && onToggle
              ? () => onToggle(toggle.key, !state[toggle.key])
              : undefined}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : null}
            {state[toggle.key] ? 'Turn off' : 'Turn on'}
          </Button>
        </div>
      ))}

      <div className="rounded-xl border border-[var(--border)] p-4">
        <p className="text-sm font-medium text-[var(--foreground)]">Rollout and retention</p>
        <dl className="mt-2 grid gap-2 text-xs text-[var(--muted)] sm:grid-cols-2">
          <div>
            <dt className="text-[var(--muted-light)]">Rollout stage</dt>
            <dd className="text-[var(--foreground)]">{describeRolloutStage(state.rolloutStage)}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted-light)]">Guest expiry</dt>
            <dd className="text-[var(--foreground)]">
              {state.guestExpirationDays ? `${state.guestExpirationDays} days` : 'No automatic expiry'}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--muted-light)]">Channel retention</dt>
            <dd className="text-[var(--foreground)]">
              {state.channelRetentionDays ? `${state.channelRetentionDays} days` : 'Keep everything'}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--muted-light)]">Audit export</dt>
            <dd className="text-[var(--foreground)]">Owners and admins, newline-delimited JSON</dd>
          </div>
        </dl>
      </div>

      {state.metrics ? (
        <div data-testid="workspace-operational-metrics" className="rounded-xl border border-[var(--border)] p-4">
          <p className="text-sm font-medium text-[var(--foreground)]">Operational signals</p>
          <dl className="mt-2 grid gap-2 text-xs text-[var(--muted)] sm:grid-cols-3">
            {[
              ['Event backlog', String(state.metrics.outboxPendingEvents)],
              ['Failed deliveries', String(state.metrics.failedDeliveries)],
              ['Agent runs queued', String(state.metrics.agentRunsQueued)],
              ['Agent runs failed', String(state.metrics.agentRunsFailed)],
              ['Authorization denials', String(state.metrics.authorizationDenials)],
              ['Invitation failures', String(state.metrics.invitationFailures)],
              ['Unread drift', String(state.metrics.unreadDriftConversations)],
              ['Provider', state.metrics.providerParity.provider],
              [
                'Convex required',
                state.metrics.providerParity.requiresConvexClient ? 'yes' : 'no',
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[var(--muted-light)]">{label}</dt>
                <dd className="text-[var(--foreground)]">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  )
}

function WorkspaceItemActions({
  item,
  state,
  onMemberRoleChange,
  onRemoveMember,
  onInvitationAction,
  onManageTeam,
  onArchiveTeam,
}: {
  item: WorkspaceManagementItem
  state: Extract<WorkspaceManagementState, { status: 'ready' }>
  onMemberRoleChange?(item: WorkspaceManagementItem, role: WorkspaceMembershipRole): void
  onRemoveMember?(item: WorkspaceManagementItem): void
  onInvitationAction?(item: WorkspaceManagementItem, action: 'cancel' | 'resend'): void
  onManageTeam?(item: WorkspaceManagementItem): void
  onArchiveTeam?(item: WorkspaceManagementItem): void
}) {
  if (item.kind === 'invitation' && state.canManage) {
    return <InvitationItemActions item={item} onInvitationAction={onInvitationAction} />
  }

  if (item.kind === 'member' && item.principalType === 'human') {
    return (
      <MemberItemActions
        item={item}
        state={state}
        onMemberRoleChange={onMemberRoleChange}
        onRemoveMember={onRemoveMember}
      />
    )
  }

  if (item.kind === 'team') {
    return (
      <TeamItemActions
        item={item}
        canArchive={state.currentRole !== 'guest'}
        onManageTeam={onManageTeam}
        onArchiveTeam={onArchiveTeam}
      />
    )
  }

  return null
}

function InvitationItemActions({
  item,
  onInvitationAction,
}: {
  item: WorkspaceManagementItem
  onInvitationAction?(item: WorkspaceManagementItem, action: 'cancel' | 'resend'): void
}) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Resend invitation to ${item.name}`}
        onClick={() => onInvitationAction?.(item, 'resend')}
      >
        <RotateCw size={12} />
        Resend
      </Button>
      {item.status === 'pending' ? (
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          aria-label={`Cancel invitation to ${item.name}`}
          onClick={() => onInvitationAction?.(item, 'cancel')}
        >
          <Trash2 size={13} />
        </Button>
      ) : null}
    </span>
  )
}

function MemberItemActions({
  item,
  state,
  onMemberRoleChange,
  onRemoveMember,
}: {
  item: WorkspaceManagementItem
  state: Extract<WorkspaceManagementState, { status: 'ready' }>
  onMemberRoleChange?(item: WorkspaceManagementItem, role: WorkspaceMembershipRole): void
  onRemoveMember?(item: WorkspaceManagementItem): void
}) {
  const isSelf = item.principalId === state.currentPrincipalId
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {state.canManage && item.role ? (
        <Select
          aria-label={`Role for ${item.name}`}
          className="h-8 w-28 py-0 text-xs capitalize"
          value={item.role}
          disabled={isSelf}
          onChange={(event) => onMemberRoleChange?.(
            item,
            event.target.value as WorkspaceMembershipRole,
          )}
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
          <option value="guest">Guest</option>
          {state.currentRole === 'owner' && state.workspaceKind === 'organization' ? (
            <option value="owner">Owner</option>
          ) : null}
        </Select>
      ) : (
        <span className="text-xs capitalize text-[var(--muted-light)]">{item.role}</span>
      )}
      {state.canManage && !isSelf ? (
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          aria-label={`Remove ${item.name}`}
          onClick={() => onRemoveMember?.(item)}
        >
          <Trash2 size={13} />
        </Button>
      ) : null}
    </span>
  )
}

function TeamItemActions({
  item,
  canArchive,
  onManageTeam,
  onArchiveTeam,
}: {
  item: WorkspaceManagementItem
  canArchive: boolean
  onManageTeam?(item: WorkspaceManagementItem): void
  onArchiveTeam?(item: WorkspaceManagementItem): void
}) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Button size="sm" variant="ghost" onClick={() => onManageTeam?.(item)}>
        Manage
      </Button>
      {canArchive ? (
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          aria-label={`Archive ${item.name}`}
          onClick={() => onArchiveTeam?.(item)}
        >
          <Archive size={13} />
        </Button>
      ) : null}
    </span>
  )
}

function unavailableActionTitle(tab: WorkspaceSettingsTab): string {
  if (tab === 'roles') return 'Custom roles are deferred; built-in roles are enforced now.'
  if (tab === 'chats-agents') return 'Named agents are created and configured from Agents in the app sidebar.'
  return 'Only workspace owners and administrators can perform this action.'
}

type WorkspacePanelAction =
  | { type: 'invite'; guest: boolean }
  | { type: 'create-team' }
  | { type: 'manage-team'; team: WorkspaceManagementItem }
  | { type: 'remove-member'; item: WorkspaceManagementItem }
  | { type: 'archive-team'; item: WorkspaceManagementItem }
  | { type: 'transfer-ownership'; item: WorkspaceManagementItem }
  | { type: 'archive-workspace' }
  | null

export function WorkspaceSettingsPanel({
  client = workspaceManagementClient,
  initialTab = 'people',
}: {
  client?: WorkspaceManagementClient
  initialTab?: WorkspaceSettingsTab
}) {
  const {
    activeWorkspace,
    status: workspaceStatus,
    error: workspaceError,
    refresh: refreshWorkspaces,
  } = useWorkspace()
  const [activeTab, setActiveTab] = useState<WorkspaceSettingsTab>(
    initialTab === 'teams' ? 'people' : initialTab,
  )
  const [state, setState] = useState<WorkspaceManagementState>({ status: 'loading' })
  const [policyState, setPolicyState] = useState<WorkspaceSharingPolicyState>({ status: 'loading' })
  const [policyBusy, setPolicyBusy] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [action, setAction] = useState<WorkspacePanelAction>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [invitePath, setInvitePath] = useState<string | null>(null)
  const [teamCandidates, setTeamCandidates] = useState<WorkspaceManagementItem[]>([])
  const [teamCandidateBusyId, setTeamCandidateBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!activeWorkspace || activeTab !== 'sharing') return
    const controller = new AbortController()
    setPolicyState({ status: 'loading' })
    void client.sharingPolicy(activeWorkspace.id, controller.signal)
      .then(async (result) => {
        if (controller.signal.aborted) return
        // Metrics are owner/admin only; a member simply sees policy without them.
        const metrics = result.canManage
          ? await client.operationalMetrics?.(activeWorkspace.id, controller.signal)
            .catch(() => undefined)
          : undefined
        if (controller.signal.aborted) return
        setPolicyState({
          status: 'ready',
          canManage: result.canManage,
          updatedAt: result.policy.updatedAt,
          publicLinksEnabled: result.policy.publicLinksEnabled,
          memberCanCreateChannels: result.policy.memberCanCreateChannels,
          memberCanCreateAgents: result.policy.memberCanCreateAgents,
          memberCanInvite: result.policy.memberCanInvite,
          membersCanEditExtensions: result.policy.workspaceExtensionsEditors !== 'admins',
          membersCanEditContent: result.policy.workspaceContentEditors !== 'admins',
          memberCanMoveScope: result.policy.memberCanMoveScope !== false,
          membersCanTopUp: result.policy.usageTopUpBy === 'members',
          legalHold: result.policy.legalHold,
          rolloutStage: result.policy.rolloutStage,
          guestExpirationDays: result.policy.guestExpirationDays,
          channelRetentionDays: result.policy.channelRetentionDays,
          metrics,
        })
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return
        setPolicyState({
          status: 'error',
          message: loadError instanceof Error ? loadError.message : 'Try again in a moment.',
        })
      })
    return () => controller.abort()
  }, [activeTab, activeWorkspace, client, refreshKey])

  useEffect(() => {
    if (!activeWorkspace || activeTab === 'sharing' || activeTab === 'billing' || activeTab === 'import') return
    const controller = new AbortController()
    setState({ status: 'loading' })
    void client.load(activeWorkspace.id, activeTab, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setState({ status: 'ready', ...result })
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return
        setState({
          status: 'error',
          message: loadError instanceof Error ? loadError.message : 'Try again in a moment.',
        })
      })
    return () => controller.abort()
  }, [activeTab, activeWorkspace, client, refreshKey])

  useEffect(() => {
    if (action?.type !== 'manage-team' || !activeWorkspace) return
    const controller = new AbortController()
    setActionError(null)
    void Promise.all([
      client.load(activeWorkspace.id, 'people', controller.signal),
      client.load(activeWorkspace.id, 'chats-agents', controller.signal),
    ]).then(([people, agents]) => {
      if (controller.signal.aborted) return
      setTeamCandidates(
        [...people.items, ...agents.items].filter((item) => item.kind === 'member'),
      )
    }).catch((error) => {
      if (!controller.signal.aborted) {
        setActionError(error instanceof Error ? error.message : 'Could not load team members.')
      }
    })
    return () => controller.abort()
  }, [action, activeWorkspace, client])

  function closeAction() {
    if (actionBusy || teamCandidateBusyId) return
    setAction(null)
    setActionError(null)
    setInvitePath(null)
    setTeamCandidates([])
  }

  async function runItemAction(itemId: string, operation: () => Promise<void>) {
    setBusyItemId(itemId)
    setActionError(null)
    try {
      await operation()
      setRefreshKey((current) => current + 1)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Workspace action failed.')
    } finally {
      setBusyItemId(null)
    }
  }

  const workspaceLabel = useMemo(() => {
    if (!activeWorkspace) return null
    const memberLabel = typeof activeWorkspace.memberCount === 'number'
      ? ` · ${activeWorkspace.memberCount} ${activeWorkspace.memberCount === 1 ? 'member' : 'members'}`
      : ''
    return `Workspace${memberLabel}`
  }, [activeWorkspace])

  function openPrimaryAction() {
    setActionError(null)
    setInvitePath(null)
    setAction(
      activeTab === 'teams'
        ? { type: 'create-team' }
        : { type: 'invite', guest: activeTab === 'guests' },
    )
  }

  function openArchiveWorkspace() {
    setActionError(null)
    setAction({ type: 'archive-workspace' })
  }

  function openRemoveMember(item: WorkspaceManagementItem) {
    setActionError(null)
    setAction({ type: 'remove-member', item })
  }

  function openManageTeam(item: WorkspaceManagementItem) {
    setActionError(null)
    setTeamCandidates([])
    setAction({ type: 'manage-team', team: item })
  }

  function openArchiveTeam(item: WorkspaceManagementItem) {
    setActionError(null)
    setAction({ type: 'archive-team', item })
  }

  function handleTabChange(tab: WorkspaceSettingsTab) {
    setActiveTab(tab)
    setActionError(null)
  }

  function handleMemberRoleChange(item: WorkspaceManagementItem, role: WorkspaceMembershipRole) {
    if (!item.principalId || !activeWorkspace) return
    if (role === 'owner') {
      setActionError(null)
      setAction({ type: 'transfer-ownership', item })
      return
    }
    void runItemAction(item.id, async () => {
      await client.updateMember(activeWorkspace.id, {
        action: 'set-role',
        principalId: item.principalId!,
        role,
      })
    })
  }

  function handleInvitationAction(item: WorkspaceManagementItem, invitationAction: 'cancel' | 'resend') {
    if (!item.invitationId || !activeWorkspace) return
    void runItemAction(item.id, async () => {
      if (invitationAction === 'resend') {
        await client.resendInvitation(activeWorkspace.id, item.invitationId!)
      } else {
        await client.cancelInvitation(activeWorkspace.id, item.invitationId!)
      }
    })
  }

  if (workspaceStatus !== 'ready' || !activeWorkspace) {
    return (
      <WorkspaceSettingsGate
        status={workspaceStatus}
        error={workspaceError}
        onRetry={refreshWorkspaces}
      />
    )
  }

  const showHeaderPrimaryAction = activeTab !== 'sharing' && activeTab !== 'billing'
    && state.status === 'ready'
    && (
      (activeTab === 'teams' && state.currentRole !== 'guest')
      || ((activeTab === 'people' || activeTab === 'guests') && state.canManage)
    )
  const headerPrimaryLabel = TABS.find((tab) => tab.id === activeTab)?.action
  const refresh = () => setRefreshKey((current) => current + 1)

  return (
    <>
      <WorkspacePanelBody
        activeWorkspace={activeWorkspace}
        workspaceLabel={workspaceLabel}
        showPrimaryAction={showHeaderPrimaryAction}
        primaryActionLabel={headerPrimaryLabel}
        onPrimaryAction={openPrimaryAction}
        onArchiveWorkspace={openArchiveWorkspace}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        actionError={actionError}
        hasAction={action !== null}
        client={client}
        policyState={policyState}
        policyBusy={policyBusy}
        setPolicyState={setPolicyState}
        setPolicyBusy={setPolicyBusy}
        setActionError={setActionError}
        onRefresh={refresh}
        state={state}
        busyItemId={busyItemId}
        onMemberRoleChange={handleMemberRoleChange}
        onRemoveMember={openRemoveMember}
        onInvitationAction={handleInvitationAction}
        onManageTeam={openManageTeam}
        onArchiveTeam={openArchiveTeam}
      />
      <WorkspaceActionDialogs
        action={action}
        actionBusy={actionBusy}
        actionError={actionError}
        invitePath={invitePath}
        teamCandidates={teamCandidates}
        teamCandidateBusyId={teamCandidateBusyId}
        workspaceId={activeWorkspace.id}
        client={client}
        refreshWorkspaces={refreshWorkspaces}
        onRefresh={refresh}
        onCloseAction={closeAction}
        setAction={setAction}
        setActionBusy={setActionBusy}
        setActionError={setActionError}
        setInvitePath={setInvitePath}
        setTeamCandidateBusyId={setTeamCandidateBusyId}
      />
    </>
  )
}

function WorkspaceSettingsGate({
  status,
  error,
  onRetry,
}: {
  status: WorkspaceLifecycleStatus
  error: string | null
  onRetry(): Promise<void>
}) {
  if (status === 'loading' || status === 'idle') {
    return (
      <div className="flex min-h-72 items-center justify-center text-sm text-[var(--muted)]">
        <Loader2 size={16} className="mr-2 animate-spin" />
        Loading workspace…
      </div>
    )
  }

  if (status === 'error') {
    return (
      <EmptyState
        className="min-h-72 px-6 py-12"
        icon={<CircleAlert size={28} />}
        title="Workspace settings are unavailable"
        description={error ?? 'Could not load your workspace.'}
        action={<Button size="sm" onClick={() => void onRetry()}>Try again</Button>}
      />
    )
  }

  return (
    <EmptyState
      className="min-h-72 px-6 py-12"
      icon={<UsersRound size={30} strokeWidth={1.5} />}
      title="Create your first workspace"
      description="Use the workspace menu in the sidebar to create a collaboration boundary."
    />
  )
}

function WorkspaceSharingTab({
  client,
  workspaceId,
  policyState,
  policyBusy,
  onRefresh,
  setPolicyState,
  setPolicyBusy,
  setActionError,
}: {
  client: WorkspaceManagementClient
  workspaceId: string
  policyState: WorkspaceSharingPolicyState
  policyBusy: boolean
  onRefresh(): void
  setPolicyState: React.Dispatch<React.SetStateAction<WorkspaceSharingPolicyState>>
  setPolicyBusy(busy: boolean): void
  setActionError(error: string | null): void
}) {
  function handleToggle(key: PolicyToggleKey, value: boolean) {
    setPolicyBusy(true)
    setActionError(null)
    void client.setSharingPolicy(workspaceId, policyPatchFor(key, value))
      .then((result) => {
        // The sidebar's New buttons follow these settings.
        invalidateWorkspaceScopePolicy(workspaceId)
        return result
      })
      .then((result) => setPolicyState((current) => ({
        ...(current.status === 'ready' ? current : {}),
        status: 'ready',
        canManage: result.canManage,
        updatedAt: result.policy.updatedAt,
        publicLinksEnabled: result.policy.publicLinksEnabled,
        memberCanCreateChannels: result.policy.memberCanCreateChannels,
        memberCanCreateAgents: result.policy.memberCanCreateAgents,
        memberCanInvite: result.policy.memberCanInvite,
        membersCanEditExtensions: result.policy.workspaceExtensionsEditors !== 'admins',
        membersCanEditContent: result.policy.workspaceContentEditors !== 'admins',
        memberCanMoveScope: result.policy.memberCanMoveScope !== false,
        membersCanTopUp: result.policy.usageTopUpBy === 'members',
        legalHold: result.policy.legalHold,
        rolloutStage: result.policy.rolloutStage,
        guestExpirationDays: result.policy.guestExpirationDays,
        channelRetentionDays: result.policy.channelRetentionDays,
        metrics: current.status === 'ready' ? current.metrics : undefined,
      })))
      .catch((error) => setActionError(
        error instanceof Error ? error.message : 'Could not update workspace policy.',
      ))
      .finally(() => setPolicyBusy(false))
  }

  return (
    <WorkspaceSharingPolicySection
      state={policyState}
      busy={policyBusy}
      onRetry={onRefresh}
      onToggle={handleToggle}
    />
  )
}

function WorkspacePanelBody({
  activeWorkspace,
  workspaceLabel,
  showPrimaryAction,
  primaryActionLabel,
  onPrimaryAction,
  onArchiveWorkspace,
  activeTab,
  onTabChange,
  actionError,
  hasAction,
  client,
  policyState,
  policyBusy,
  setPolicyState,
  setPolicyBusy,
  setActionError,
  onRefresh,
  state,
  busyItemId,
  onMemberRoleChange,
  onRemoveMember,
  onInvitationAction,
  onManageTeam,
  onArchiveTeam,
}: {
  activeWorkspace: WorkspaceSummary
  workspaceLabel: string | null
  showPrimaryAction: boolean
  primaryActionLabel: string | undefined
  onPrimaryAction(): void
  onArchiveWorkspace(): void
  activeTab: WorkspaceSettingsTab
  onTabChange(tab: WorkspaceSettingsTab): void
  actionError: string | null
  hasAction: boolean
  client: WorkspaceManagementClient
  policyState: WorkspaceSharingPolicyState
  policyBusy: boolean
  setPolicyState: React.Dispatch<React.SetStateAction<WorkspaceSharingPolicyState>>
  setPolicyBusy(busy: boolean): void
  setActionError(error: string | null): void
  onRefresh(): void
  state: WorkspaceManagementState
  busyItemId: string | null
  onMemberRoleChange(item: WorkspaceManagementItem, role: WorkspaceMembershipRole): void
  onRemoveMember(item: WorkspaceManagementItem): void
  onInvitationAction(item: WorkspaceManagementItem, action: 'cancel' | 'resend'): void
  onManageTeam(item: WorkspaceManagementItem): void
  onArchiveTeam(item: WorkspaceManagementItem): void
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)]">
      <header className="flex items-center gap-3 px-5 py-4">
        <WorkspaceAvatar workspace={activeWorkspace} size="lg" />
        <div className="min-w-0 flex-1">
          <WorkspaceNameEditor workspace={activeWorkspace} client={client} />
          <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{workspaceLabel}</p>
        </div>
        {showPrimaryAction ? (
          <Button size="sm" onClick={onPrimaryAction}>
            {primaryActionLabel}
          </Button>
        ) : null}
        {activeWorkspace.kind === 'organization' && activeWorkspace.role === 'owner' ? (
          <Button size="sm" variant="ghost" onClick={onArchiveWorkspace}>
            <Archive size={13} />
            Archive
          </Button>
        ) : null}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] font-medium capitalize text-[var(--muted)]">
          <KeyRound size={11} />
          {activeWorkspace.role}
        </span>
      </header>
      <WorkspaceSettingsTabs activeTab={activeTab} onTabChange={onTabChange} />
      {actionError && !hasAction ? (
        <div role="alert" className="border-b border-[var(--border)] bg-red-500/5 px-5 py-2.5 text-xs text-red-500">
          {actionError}
        </div>
      ) : null}
      {activeTab === 'billing' ? (
        <WorkspaceBillingSection client={client} workspace={activeWorkspace} />
      ) : activeTab === 'import' ? (
        <ImportPanel />
      ) : activeTab === 'sharing' ? (
        <WorkspaceSharingTab
          client={client}
          workspaceId={activeWorkspace.id}
          policyState={policyState}
          policyBusy={policyBusy}
          onRefresh={onRefresh}
          setPolicyState={setPolicyState}
          setPolicyBusy={setPolicyBusy}
          setActionError={setActionError}
        />
      ) : (
      <WorkspaceManagementContent
        tab={activeTab}
        state={state}
        busyItemId={busyItemId}
        onRetry={onRefresh}
        onPrimaryAction={onPrimaryAction}
        onMemberRoleChange={onMemberRoleChange}
        onRemoveMember={onRemoveMember}
        onInvitationAction={onInvitationAction}
        onManageTeam={onManageTeam}
        onArchiveTeam={onArchiveTeam}
      />
      )}
      {activeTab === 'chats-agents' ? (
        <footer className="flex items-center gap-2 border-t border-[var(--border)] px-5 py-3 text-[11px] text-[var(--muted-light)]">
          <MessageSquareText size={12} />
          Personal chats stay private; shared rooms and named agents belong to this workspace.
        </footer>
      ) : null}
    </section>
  )
}

function WorkspaceActionDialogs({
  action,
  actionBusy,
  actionError,
  invitePath,
  teamCandidates,
  teamCandidateBusyId,
  workspaceId,
  client,
  refreshWorkspaces,
  onRefresh,
  onCloseAction,
  setAction,
  setActionBusy,
  setActionError,
  setInvitePath,
  setTeamCandidateBusyId,
}: {
  action: WorkspacePanelAction
  actionBusy: boolean
  actionError: string | null
  invitePath: string | null
  teamCandidates: WorkspaceManagementItem[]
  teamCandidateBusyId: string | null
  workspaceId: string
  client: WorkspaceManagementClient
  refreshWorkspaces(): Promise<void>
  onRefresh(): void
  onCloseAction(): void
  setAction: React.Dispatch<React.SetStateAction<WorkspacePanelAction>>
  setActionBusy(busy: boolean): void
  setActionError(error: string | null): void
  setInvitePath(path: string | null): void
  setTeamCandidateBusyId(id: string | null): void
}) {
  async function runDialogAction(operation: () => Promise<void>, failureMessage: string) {
    setActionBusy(true)
    setActionError(null)
    try {
      await operation()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : failureMessage)
    } finally {
      setActionBusy(false)
    }
  }

  async function handleInvite(input: {
    email: string
    role: Exclude<WorkspaceMembershipRole, 'owner'>
  }) {
    await runDialogAction(async () => {
      const response = await client.invite(workspaceId, input)
      setInvitePath(response.invitePath)
      onRefresh()
    }, 'Could not create invitation.')
  }

  async function handleCreateTeam(input: { name: string; description?: string }) {
    await runDialogAction(async () => {
      await client.createTeam(workspaceId, input)
      onRefresh()
      setAction(null)
    }, 'Could not create team.')
  }

  async function handleTeamMemberToggle(principalId: string, member: boolean) {
    if (action?.type !== 'manage-team') return
    setTeamCandidateBusyId(principalId)
    setActionError(null)
    try {
      if (member) {
        await client.addTeamMember(workspaceId, action.team.id, principalId)
      } else {
        await client.removeTeamMember(workspaceId, action.team.id, principalId)
      }
      setAction((current) => {
        if (current?.type !== 'manage-team') return current
        const ids = new Set(current.team.teamMemberPrincipalIds ?? [])
        if (member) ids.add(principalId)
        else ids.delete(principalId)
        return {
          ...current,
          team: { ...current.team, teamMemberPrincipalIds: [...ids] },
        }
      })
      onRefresh()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update team.')
    } finally {
      setTeamCandidateBusyId(null)
    }
  }

  async function handleRemoveMember() {
    if (action?.type !== 'remove-member' || !action.item.principalId) return
    const { principalId } = action.item
    await runDialogAction(async () => {
      await client.removeMember(workspaceId, principalId)
      setAction(null)
      onRefresh()
    }, 'Could not remove member.')
  }

  async function handleTransferOwnership() {
    if (action?.type !== 'transfer-ownership' || !action.item.principalId) return
    const { principalId } = action.item
    await runDialogAction(async () => {
      await client.updateMember(workspaceId, {
        action: 'transfer-ownership',
        principalId,
      })
      setAction(null)
      await refreshWorkspaces()
      onRefresh()
    }, 'Could not transfer ownership.')
  }

  async function handleArchiveTeam() {
    if (action?.type !== 'archive-team') return
    const { item } = action
    await runDialogAction(async () => {
      await client.archiveTeam(workspaceId, item.id)
      setAction(null)
      onRefresh()
    }, 'Could not archive team.')
  }

  async function handleArchiveWorkspace() {
    setActionBusy(true)
    setActionError(null)
    try {
      await client.archiveWorkspace(workspaceId)
      setAction(null)
      await refreshWorkspaces()
      window.location.assign('/app/chat')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not archive workspace.')
    } finally {
      setActionBusy(false)
    }
  }

  return (
    <>
      {action?.type === 'invite' ? (
      <InviteWorkspaceDialog
        open
        guest={action.guest}
        busy={actionBusy}
        error={actionError}
        invitePath={invitePath}
        onOpenChange={(open) => {
          if (!open) onCloseAction()
        }}
        onInvite={handleInvite}
      />
      ) : null}

      {action?.type === 'create-team' ? (
      <CreateTeamDialog
        open
        busy={actionBusy}
        error={actionError}
        onOpenChange={(open) => {
          if (!open) onCloseAction()
        }}
        onCreate={handleCreateTeam}
      />
      ) : null}

      <TeamMembersDialog
        open={action?.type === 'manage-team'}
        team={action?.type === 'manage-team' ? action.team : null}
        candidates={teamCandidates}
        busyPrincipalId={teamCandidateBusyId}
        error={actionError}
        onOpenChange={(open) => {
          if (!open) onCloseAction()
        }}
        onToggle={handleTeamMemberToggle}
      />

      <ConfirmWorkspaceActionDialog
        open={action?.type === 'remove-member'}
        title="Remove workspace member?"
        description={action?.type === 'remove-member'
          ? `${action.item.name} will immediately lose workspace access. Existing audit attribution is preserved.`
          : ''}
        confirmLabel="Remove member"
        destructive
        busy={actionBusy}
        error={actionError}
        onOpenChange={(open) => {
          if (!open) onCloseAction()
        }}
        onConfirm={handleRemoveMember}
      />

      <ConfirmWorkspaceActionDialog
        open={action?.type === 'transfer-ownership'}
        title="Transfer workspace ownership?"
        description={action?.type === 'transfer-ownership'
          ? `${action.item.name} will become the owner. You will become an administrator.`
          : ''}
        confirmLabel="Transfer ownership"
        busy={actionBusy}
        error={actionError}
        onOpenChange={(open) => {
          if (!open) onCloseAction()
        }}
        onConfirm={handleTransferOwnership}
      />

      <ConfirmWorkspaceActionDialog
        open={action?.type === 'archive-team'}
        title="Archive team?"
        description={action?.type === 'archive-team'
          ? `${action.item.name} will stop being available for new sharing decisions. Existing audit history is preserved.`
          : ''}
        confirmLabel="Archive team"
        destructive
        busy={actionBusy}
        error={actionError}
        onOpenChange={(open) => {
          if (!open) onCloseAction()
        }}
        onConfirm={handleArchiveTeam}
      />

      <ConfirmWorkspaceActionDialog
        open={action?.type === 'archive-workspace'}
        title="Archive this workspace?"
        description="Members will immediately lose access to this workspace. Data is retained for the configured retention period; permanent erasure is a separate audited operation."
        confirmLabel="Archive workspace"
        destructive
        busy={actionBusy}
        error={actionError}
        onOpenChange={(open) => {
          if (!open) onCloseAction()
        }}
        onConfirm={handleArchiveWorkspace}
      />
    </>
  )
}
