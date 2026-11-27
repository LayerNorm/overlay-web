/**
 * Workspace management — native counterpart of web `WorkspaceSettingsPanel`.
 *
 * `/workspace` is a SwiftUI `Form` home; each section is its own pushed page
 * (`/workspace?section=people`), like Settings. Member, invitation and team
 * rows are native menus; destructive steps confirm with a native dialog.
 * People, agents, teams and billing read live Convex views, so lists
 * update on their own after an action. Billing stays read-only (checkout and
 * the portal live on web).
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import {
  Button,
  ContentUnavailableView,
  ContextMenu,
  Divider,
  Form,
  HStack,
  Host,
  Image as Symbol,
  LabeledContent,
  Menu,
  Picker,
  ProgressView,
  Section,
  Spacer,
  Text,
  Toggle,
  VStack,
} from '@expo/ui/swift-ui'
import {
  buttonStyle,
  contentShape,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  shapes,
  tag,
  tint,
} from '@expo/ui/swift-ui/modifiers'
import type {
  WorkspaceManagementItem,
  WorkspaceMembershipRole,
  WorkspaceOperationalMetrics,
  WorkspaceSharingPolicy,
} from '@overlay/workspace-contracts'
import { useTheme } from '../../hooks/useTheme'
import { useLiveResource } from '../../hooks/useLiveResource'
import { useAppSession } from '../../contexts/AppSessionContext'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useNativeDataReady } from '../../contexts/ConvexAuthProvider'
import { useSwitchTint } from '../../lib/nativeControls'
import { api } from '../../services/convexClient'
import { getRequestWorkspaceId } from '../../services/appApi'
import {
  archiveWorkspace,
  archiveWorkspaceTeam,
  cancelWorkspaceInvitation,
  createWorkspaceTeam,
  exportWorkspaceAudit,
  loadOperationalMetrics,
  loadSharedWithMe,
  loadSharingPolicy,
  removeWorkspaceMember,
  resendWorkspaceInvitation,
  setMemberSpendCap,
  setTeamMembership,
  updateSharingPolicy,
  updateWorkspaceMember,
  type WorkspaceSharedResource,
} from '../../services/workspaceManagementService'
import { FeatureGate } from '../ui/FeatureGate'
import { RoomConfirmDialog, type RoomConfirmation } from '../chat/RoomSheets'

const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' })
const rowButton = [buttonStyle('borderless')]
const rowShape = contentShape(shapes.rectangle())
type SymbolName = NonNullable<React.ComponentProps<typeof Symbol>['systemName']>
type LiveView = 'people' | 'teams' | 'chats-agents'

type SectionKey = 'people' | 'agents' | 'teams' | 'sharing' | 'billing' | 'shared' | 'team'

const SECTIONS: Array<{ key: Exclude<SectionKey, 'team'>; title: string; icon: SymbolName; view?: LiveView }> = [
  { key: 'people', title: 'People', icon: 'person.2', view: 'people' },
  { key: 'agents', title: 'Agents', icon: 'sparkles', view: 'chats-agents' },
  { key: 'teams', title: 'Teams', icon: 'person.3', view: 'teams' },
  { key: 'sharing', title: 'Sharing and policies', icon: 'lock.shield' },
  { key: 'billing', title: 'Billing', icon: 'creditcard' },
  { key: 'shared', title: 'Shared with me', icon: 'tray' },
]

const POLICY_TOGGLES: Array<{
  key: 'publicLinksEnabled' | 'memberCanCreateChannels' | 'memberCanCreateAgents' | 'memberCanInvite' | 'legalHold'
  label: string
  description: string
}> = [
  { key: 'publicLinksEnabled', label: 'Public links', description: 'Anyone with the link can open shared chats and files. Sharing with people, agents, teams and rooms is unaffected.' },
  { key: 'memberCanCreateChannels', label: 'Members can create channels', description: 'When off, only owners and admins create channels.' },
  { key: 'memberCanCreateAgents', label: 'Members can create agents', description: 'When off, only owners and admins add named agents.' },
  { key: 'memberCanInvite', label: 'Members can invite people', description: 'When on, members may send workspace invitations.' },
  { key: 'legalHold', label: 'Legal hold', description: 'While on, retention never deletes channel history.' },
]

const sentence = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replace(/[_-]/g, ' ')

function failure(title: string, cause: unknown) {
  Alert.alert(title, cause instanceof Error ? cause.message : 'Try again in a moment.')
}

/** Runs a workspace action unless the workspace changed underneath it. */
function useScopedAction() {
  const { activeWorkspaceId } = useWorkspace()
  return useCallback(
    (title: string, operation: (workspaceId: string) => Promise<unknown>, after?: () => void) => {
      const scope = activeWorkspaceId
      if (!scope || getRequestWorkspaceId() !== scope) return
      void operation(scope)
        .then(() => { if (getRequestWorkspaceId() === scope) after?.() })
        .catch((cause) => { if (getRequestWorkspaceId() === scope) failure(title, cause) })
    },
    [activeWorkspaceId],
  )
}

function useManagementView(view: LiveView | undefined) {
  const ready = useNativeDataReady()
  const { activeWorkspaceId } = useWorkspace()
  return useLiveResource(
    api.collaboration.management.view,
    ready && activeWorkspaceId && view ? { workspaceId: activeWorkspaceId, view } : null,
  )
}

/** Native page chrome: title, a SwiftUI `Form`, and the shared confirmation dialog. */
function Page({
  title,
  confirmation,
  onCloseConfirmation,
  toolbar,
  children,
}: {
  title: string
  confirmation?: RoomConfirmation | null
  onCloseConfirmation?: () => void
  toolbar?: React.ReactNode
  children: React.ReactNode
}) {
  const { theme, isDark } = useTheme()
  return (
    <>
      <Stack.Screen options={{ title, headerLargeTitle: false }} />
      {toolbar}
      <Host style={{ flex: 1 }} colorScheme={isDark ? 'dark' : 'light'}>
        <Form modifiers={[tint(theme.foreground as string)]}>{children}</Form>
      </Host>
      {onCloseConfirmation ? <RoomConfirmDialog request={confirmation ?? null} onClose={onCloseConfirmation} /> : null}
    </>
  )
}

function Empty({ title, systemImage, description }: { title: string; systemImage: SymbolName; description: string }) {
  const { isDark } = useTheme()
  return (
    <Host style={{ flex: 1 }} colorScheme={isDark ? 'dark' : 'light'}>
      <ContentUnavailableView title={title} systemImage={systemImage} description={description} />
    </Host>
  )
}

/** Icon, name and a secondary line, with an optional trailing value. */
function RowLabel({ icon, title, subtitle, trailing }: { icon: SymbolName; title: string; subtitle?: string; trailing?: React.ReactNode }) {
  return (
    <HStack spacing={12} modifiers={[rowShape]}>
      <Symbol systemName={icon} size={17} modifiers={[frame({ width: 30 }), secondary]} />
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[lineLimit(1)]}>{title}</Text>
        {subtitle ? <Text modifiers={[secondary, font({ size: 13 }), lineLimit(1)]}>{subtitle}</Text> : null}
      </VStack>
      <Spacer />
      {trailing}
    </HStack>
  )
}

function itemIcon(item: WorkspaceManagementItem): SymbolName {
  if (item.kind === 'invitation') return 'envelope'
  if (item.kind === 'team') return 'person.3'
  return item.principalType === 'agent' ? 'sparkles' : 'person.crop.circle'
}

function itemSubtitle(item: WorkspaceManagementItem) {
  if (item.kind === 'invitation') return `Invited as ${item.role ?? 'member'}`
  return item.description || undefined
}

/** Role on the right; a non-active status or a type badge when there's no role. */
function itemTrailing(item: WorkspaceManagementItem) {
  if (item.kind === 'invitation') return item.status && item.status !== 'pending' ? sentence(item.status) : undefined
  const status = item.status && item.status !== 'active' ? sentence(item.status) : null
  if (item.role) return [sentence(item.role), status].filter(Boolean).join(' · ')
  return item.badge && item.badge !== 'active' && item.badge !== 'agent' ? sentence(item.badge) : undefined
}

// ---------------------------------------------------------------------------
// Home

function WorkspaceHome() {
  const router = useRouter()
  const { activeWorkspace, activeWorkspaceId, refresh } = useWorkspace()
  const people = useManagementView('people')
  const [confirmation, setConfirmation] = useState<RoomConfirmation | null>(null)
  const isOrganization = activeWorkspace?.kind === 'organization'
  const role = people.data?.currentRole ?? activeWorkspace?.role
  const memberCount = people.data?.items.filter((item) => item.kind === 'member').length
  const open = (section: SectionKey) => router.push({ pathname: '/workspace', params: { section } })

  const confirmArchive = () =>
    setConfirmation({
      title: `Archive ${activeWorkspace?.name ?? 'this workspace'}?`,
      message: 'It stops accepting new work. Its audit history is kept.',
      label: 'Archive workspace',
      destructive: true,
      run: () => {
        if (!activeWorkspaceId) return
        void archiveWorkspace(activeWorkspaceId)
          .then(() => refresh())
          .then(() => router.back())
          .catch((cause) => failure('Could not archive the workspace', cause))
      },
    })

  return (
    <Page title={activeWorkspace?.name ?? 'Workspace'} confirmation={confirmation} onCloseConfirmation={() => setConfirmation(null)}>
      <Section>
        <LabeledContent label="Type">
          <Text>{isOrganization ? 'Team workspace' : 'Personal workspace'}</Text>
        </LabeledContent>
        {role ? (
          <LabeledContent label="Your role">
            <Text>{sentence(role)}</Text>
          </LabeledContent>
        ) : null}
        {memberCount !== undefined ? (
          <LabeledContent label="Members">
            <Text>{String(memberCount)}</Text>
          </LabeledContent>
        ) : null}
      </Section>
      <Section>
        {SECTIONS.slice(0, 4).map((section) => (
          <Button key={section.key} onPress={() => open(section.key)} modifiers={rowButton}>
            <RowLabel icon={section.icon} title={section.title} trailing={<Symbol systemName="chevron.right" size={13} modifiers={[secondary]} />} />
          </Button>
        ))}
      </Section>
      <Section>
        {SECTIONS.slice(4).map((section) => (
          <Button key={section.key} onPress={() => open(section.key)} modifiers={rowButton}>
            <RowLabel icon={section.icon} title={section.title} trailing={<Symbol systemName="chevron.right" size={13} modifiers={[secondary]} />} />
          </Button>
        ))}
      </Section>
      {isOrganization && role === 'owner' ? (
        <Section footer={<Text>Archived workspaces stop accepting new work.</Text>}>
          <Button role="destructive" label="Archive workspace" onPress={confirmArchive} />
        </Section>
      ) : null}
    </Page>
  )
}

// ---------------------------------------------------------------------------
// People and agents

function MemberMenu({
  item,
  label,
  canTransfer,
  onConfirm,
}: {
  item: WorkspaceManagementItem
  label: React.ReactNode
  canTransfer: boolean
  onConfirm: (request: RoomConfirmation) => void
}) {
  const run = useScopedAction()
  const principalId = item.principalId!
  return (
    <Menu label={label}>
      <Picker
        label="Role"
        systemImage="shield"
        selection={item.role ?? 'member'}
        onSelectionChange={(role: WorkspaceMembershipRole) => {
          if (role === item.role) return
          run('Could not change the role', (workspaceId) => updateWorkspaceMember(workspaceId, { action: 'set-role', principalId, role }))
        }}
      >
        <Text modifiers={[tag('member')]}>Member</Text>
        <Text modifiers={[tag('admin')]}>Admin</Text>
      </Picker>
      {canTransfer ? (
        <Button
          label="Make owner"
          systemImage="key"
          onPress={() =>
            onConfirm({
              title: `Make ${item.name} the owner?`,
              message: 'You will become an admin.',
              label: 'Transfer ownership',
              run: () => run('Could not transfer ownership', (workspaceId) => updateWorkspaceMember(workspaceId, { action: 'transfer-ownership', principalId })),
            })
          }
        />
      ) : null}
      <Divider />
      <Button
        label="Remove from workspace"
        systemImage="person.badge.minus"
        role="destructive"
        onPress={() =>
          onConfirm({
            title: `Remove ${item.name}?`,
            message: 'They lose access to this workspace right away.',
            label: 'Remove',
            destructive: true,
            run: () => run('Could not remove the member', (workspaceId) => removeWorkspaceMember(workspaceId, principalId)),
          })
        }
      />
    </Menu>
  )
}

function InvitationMenu({ item, label, onConfirm }: { item: WorkspaceManagementItem; label: React.ReactNode; onConfirm: (request: RoomConfirmation) => void }) {
  const run = useScopedAction()
  const invitationId = item.invitationId!
  return (
    <Menu label={label}>
      <Button
        label="Resend invitation"
        systemImage="arrow.clockwise"
        onPress={() => run('Could not resend', (workspaceId) => resendWorkspaceInvitation(workspaceId, invitationId), () => Alert.alert('Invitation sent again'))}
      />
      {item.status === 'pending' ? (
        <Button
          label="Cancel invitation"
          systemImage="xmark"
          role="destructive"
          onPress={() =>
            onConfirm({
              title: `Cancel the invitation to ${item.name}?`,
              label: 'Cancel invitation',
              destructive: true,
              run: () => run('Could not cancel', (workspaceId) => cancelWorkspaceInvitation(workspaceId, invitationId)),
            })
          }
        />
      ) : null}
    </Menu>
  )
}

const EMPTY: Record<string, [string, SymbolName, string]> = {
  people: ['No other people yet', 'person.2', 'Invite teammates to work together in chats and on shared files.'],
  agents: ['No shared agents', 'sparkles', 'Named agents for this workspace are managed from Agents.'],
}

function MembersPage({ section }: { section: 'people' | 'agents' }) {
  const router = useRouter()
  const { activeWorkspace } = useWorkspace()
  const meta = SECTIONS.find((candidate) => candidate.key === section)!
  const result = useManagementView(meta.view)
  const [confirmation, setConfirmation] = useState<RoomConfirmation | null>(null)
  const data = result.data
  const canInvite = section !== 'agents' && data?.canManage === true
  const toolbar = canInvite ? (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button
        icon="plus"
        accessibilityLabel="Invite people"
        onPress={() => router.push({ pathname: '/settings', params: { section: 'invite' } })}
      />
    </Stack.Toolbar>
  ) : null

  if (data && !data.items.length) {
    const [title, icon, description] = EMPTY[section]
    return (
      <>
        <Stack.Screen options={{ title: meta.title, headerLargeTitle: false }} />
        {toolbar}
        <Empty title={title} systemImage={icon} description={description} />
      </>
    )
  }

  const items = data?.items ?? []
  const members = items.filter((item) => item.kind !== 'invitation')
  const invitations = items.filter((item) => item.kind === 'invitation')
  const canTransfer = data?.currentRole === 'owner' && activeWorkspace?.kind === 'organization'

  const row = (item: WorkspaceManagementItem) => {
    const self = item.principalId === data?.currentPrincipalId
    const label = (
      <RowLabel
        icon={itemIcon(item)}
        title={`${item.name}${self ? ' (you)' : ''}`}
        subtitle={itemSubtitle(item)}
        trailing={itemTrailing(item) ? <Text modifiers={[secondary]}>{itemTrailing(item)!}</Text> : undefined}
      />
    )
    if (item.kind === 'invitation' && data?.canManage && item.invitationId)
      return <InvitationMenu key={item.id} item={item} label={label} onConfirm={setConfirmation} />
    if (item.kind === 'member' && item.principalType === 'human' && data?.canManage && !self && item.principalId && item.role !== 'owner')
      return <MemberMenu key={item.id} item={item} label={label} canTransfer={canTransfer} onConfirm={setConfirmation} />
    return <React.Fragment key={item.id}>{label}</React.Fragment>
  }

  return (
    <Page title={meta.title} toolbar={toolbar} confirmation={confirmation} onCloseConfirmation={() => setConfirmation(null)}>
      <Section
        footer={
          data === undefined ? (
            <Text>Loading…</Text>
          ) : section === 'agents' ? (
            <Text>Personal chats stay private; shared rooms and named agents belong to this workspace.</Text>
          ) : data?.canManage ? (
            <Text>Tap someone to change their role or remove them.</Text>
          ) : undefined
        }
      >
        {members.map(row)}
      </Section>
      {invitations.length ? <Section title="Invitations">{invitations.map(row)}</Section> : null}
    </Page>
  )
}

// ---------------------------------------------------------------------------
// Teams

function TeamsPage() {
  const router = useRouter()
  const result = useManagementView('teams')
  const run = useScopedAction()
  const [confirmation, setConfirmation] = useState<RoomConfirmation | null>(null)
  const canEdit = Boolean(result.data)
  const newTeam = () =>
    Alert.prompt('New team', 'Group people and agents so you can share with them together.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Create',
        onPress: (value?: string) => {
          const name = value?.trim()
          if (name) run('Could not create the team', (workspaceId) => createWorkspaceTeam(workspaceId, name))
        },
      },
    ])
  const toolbar = canEdit ? (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button icon="plus" accessibilityLabel="New team" onPress={newTeam} />
    </Stack.Toolbar>
  ) : null

  if (result.data && !result.data.items.length) {
    return (
      <>
        <Stack.Screen options={{ title: 'Teams', headerLargeTitle: false }} />
        {toolbar}
        <Empty title="No teams yet" systemImage="person.3" description="Group people and agents so access can be managed together." />
      </>
    )
  }

  return (
    <Page title="Teams" toolbar={toolbar} confirmation={confirmation} onCloseConfirmation={() => setConfirmation(null)}>
      <Section footer={<Text>{result.data === undefined ? 'Loading…' : 'Touch and hold a team to archive it.'}</Text>}>
        {(result.data?.items ?? []).map((team) => {
          const count = team.teamMemberPrincipalIds?.length ?? 0
          const button = (
            <Button onPress={() => router.push({ pathname: '/workspace', params: { section: 'team', id: team.id } })} modifiers={rowButton}>
              <RowLabel
                icon="person.3"
                title={team.name}
                subtitle={count === 1 ? '1 member' : `${count} members`}
                trailing={<Symbol systemName="chevron.right" size={13} modifiers={[secondary]} />}
              />
            </Button>
          )
          if (!canEdit) return <React.Fragment key={team.id}>{button}</React.Fragment>
          return (
            <ContextMenu key={team.id}>
              <ContextMenu.Items>
                <Button
                  label="Archive team"
                  systemImage="archivebox"
                  role="destructive"
                  onPress={() =>
                    setConfirmation({
                      title: `Archive ${team.name}?`,
                      message: 'It will no longer be available for sharing.',
                      label: 'Archive team',
                      destructive: true,
                      run: () => run('Could not archive the team', (workspaceId) => archiveWorkspaceTeam(workspaceId, team.id)),
                    })
                  }
                />
              </ContextMenu.Items>
              <ContextMenu.Trigger>{button}</ContextMenu.Trigger>
            </ContextMenu>
          )
        })}
      </Section>
    </Page>
  )
}

function TeamPage({ teamId }: { teamId: string }) {
  const switchTint = useSwitchTint()
  const run = useScopedAction()
  const teams = useManagementView('teams')
  const people = useManagementView('people')
  const agents = useManagementView('chats-agents')
  const team = teams.data?.items.find((item) => item.id === teamId)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  if (teams.data && !team) return <Empty title="Team not found" systemImage="person.3" description="It may have been archived." />
  const members = new Set(team?.teamMemberPrincipalIds ?? [])
  const editable = Boolean(teams.data)
  const candidates = (items: WorkspaceManagementItem[] | undefined) =>
    (items ?? []).filter((item) => item.kind === 'member' && item.principalId)
  const toggle = (principalId: string, on: boolean) => {
    setPending((current) => ({ ...current, [principalId]: on }))
    run(
      'Could not update the team',
      (workspaceId) => setTeamMembership(workspaceId, teamId, principalId, on).finally(() =>
        setPending((current) => {
          const next = { ...current }
          delete next[principalId]
          return next
        }),
      ),
    )
  }
  const rows = (items: WorkspaceManagementItem[]) =>
    items.map((item) => (
      <Toggle
        key={item.principalId}
        label={item.name}
        isOn={pending[item.principalId!] ?? members.has(item.principalId!)}
        onIsOnChange={(on) => toggle(item.principalId!, on)}
        modifiers={[...switchTint, disabled(!editable)]}
      />
    ))
  const humans = candidates(people.data?.items)
  const bots = candidates(agents.data?.items)
  return (
    <Page title={team?.name ?? 'Team'}>
      <Section title="People" footer={people.data === undefined ? <Text>Loading…</Text> : undefined}>
        {rows(humans)}
      </Section>
      {bots.length ? <Section title="Agents">{rows(bots)}</Section> : null}
    </Page>
  )
}

// ---------------------------------------------------------------------------
// Sharing and policies

function SharingPage() {
  const switchTint = useSwitchTint()
  const { activeWorkspaceId } = useWorkspace()
  const [policy, setPolicy] = useState<{ policy: WorkspaceSharingPolicy; canManage: boolean } | null>(null)
  const [metrics, setMetrics] = useState<WorkspaceOperationalMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!activeWorkspaceId) return
    let active = true
    loadSharingPolicy(activeWorkspaceId)
      .then(async (result) => {
        if (!active) return
        setPolicy(result)
        if (result.canManage) {
          const signals = await loadOperationalMetrics(activeWorkspaceId).catch(() => null)
          if (active) setMetrics(signals)
        }
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load the policies.') })
    return () => { active = false }
  }, [activeWorkspaceId])

  const change = (key: (typeof POLICY_TOGGLES)[number]['key'], value: boolean) => {
    const scope = activeWorkspaceId
    if (!policy?.canManage || !scope) return
    const previous = policy
    setPolicy({ ...policy, policy: { ...policy.policy, [key]: value } })
    updateSharingPolicy(scope, { [key]: value })
      .then((result) => { if (getRequestWorkspaceId() === scope) setPolicy(result) })
      .catch((cause) => {
        if (getRequestWorkspaceId() !== scope) return
        setPolicy(previous)
        failure('Could not update the policy', cause)
      })
  }

  const exportAudit = async () => {
    if (!activeWorkspaceId || exporting) return
    setExporting(true)
    try {
      const body = await exportWorkspaceAudit(activeWorkspaceId)
      const file = new File(Paths.cache, `workspace-audit-${Date.now()}.ndjson`)
      file.write(body)
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'application/x-ndjson' })
    } catch (cause) {
      failure('Could not export audit history', cause)
    } finally {
      setExporting(false)
    }
  }

  const value = policy?.policy
  return (
    <Page title="Sharing and policies">
      {error ? (
        <Section>
          <Text modifiers={[secondary]}>{error}</Text>
        </Section>
      ) : null}
      {!policy && !error ? (
        <Section footer={<Text>Loading…</Text>}>
          {null}
        </Section>
      ) : null}
      {value
        ? POLICY_TOGGLES.map((toggle) => (
            <Section key={toggle.key} footer={<Text>{toggle.description}</Text>}>
              <Toggle
                label={toggle.label}
                isOn={Boolean(value[toggle.key])}
                onIsOnChange={(on) => change(toggle.key, on)}
                modifiers={[...switchTint, disabled(!policy?.canManage)]}
              />
            </Section>
          ))
        : null}
      {value ? (
        <Section title="Rollout and retention" footer={!policy?.canManage ? <Text>Only owners and admins can change these settings.</Text> : undefined}>
          <LabeledContent label="Rollout">
            <Text>{value.rolloutStage === 'dogfood' ? 'Internal' : value.rolloutStage === 'invited' ? 'Selected workspaces' : 'General'}</Text>
          </LabeledContent>
          <LabeledContent label="Channel history">
            <Text>{value.channelRetentionDays ? `${value.channelRetentionDays} days` : 'Kept forever'}</Text>
          </LabeledContent>
        </Section>
      ) : null}
      {metrics ? (
        <Section title="Health">
          {(
            [
              ['Events waiting', metrics.outboxPendingEvents],
              ['Failed deliveries', metrics.failedDeliveries],
              ['Agent runs queued', metrics.agentRunsQueued],
              ['Agent runs failed', metrics.agentRunsFailed],
              ['Access denials', metrics.authorizationDenials],
              ['Invitation failures', metrics.invitationFailures],
            ] as const
          ).map(([label, count]) => (
            <LabeledContent key={label} label={label}>
              <Text>{String(count)}</Text>
            </LabeledContent>
          ))}
        </Section>
      ) : null}
      {policy?.canManage ? (
        <Section footer={<Text>A newline-delimited JSON file of workspace activity.</Text>}>
          <Button label={exporting ? 'Exporting…' : 'Export audit history'} systemImage="square.and.arrow.up" onPress={() => void exportAudit()} />
        </Section>
      ) : null}
    </Page>
  )
}

// ---------------------------------------------------------------------------
// Billing

function BillingPage() {
  const router = useRouter()
  const ready = useNativeDataReady()
  const { activeWorkspace, activeWorkspaceId } = useWorkspace()
  const isOrganization = activeWorkspace?.kind === 'organization'
  const billing = useLiveResource(
    api.billing.browse.workspaceSummary,
    ready && isOrganization && activeWorkspaceId ? { workspaceId: activeWorkspaceId } : null,
  )
  if (!isOrganization) {
    return (
      <Page title="Billing">
        <Section footer={<Text>Personal workspaces use your own plan.</Text>}>
          <Button onPress={() => router.push({ pathname: '/settings', params: { section: 'billing' } })} modifiers={rowButton}>
            <RowLabel icon="creditcard" title="Your plan and credits" trailing={<Symbol systemName="chevron.right" size={13} modifiers={[secondary]} />} />
          </Button>
        </Section>
      </Page>
    )
  }
  const data = billing.data
  const credits = (value: number) => Math.round(value).toLocaleString('en-US')
  return (
    <Page title="Billing">
      {data === undefined ? (
        <Section footer={<Text>Loading…</Text>}>{null}</Section>
      ) : !data || !data.initialized ? (
        <Section title="Workspace wallet" footer={<Text>Shared agents, files, automations and hosted work draw on this wallet. Set it up on the web.</Text>}>
          <LabeledContent label="Status">
            <Text>Not set up</Text>
          </LabeledContent>
        </Section>
      ) : (
        <>
          <Section title="Credits">
            <LabeledContent label="Remaining">
              <Text>{credits(data.credits.remaining)}</Text>
            </LabeledContent>
            <LabeledContent label="Used this period">
              <Text>{credits(data.credits.used)}</Text>
            </LabeledContent>
            <LabeledContent label="Top-up balance">
              <Text>{credits(data.credits.topUpBalance)}</Text>
            </LabeledContent>
            <VStack alignment="leading" spacing={6}>
              <ProgressView value={Math.min(100, Math.max(0, data.credits.allowancePercentUsed)) / 100} />
              <Text modifiers={[secondary, font({ size: 13 })]}>{`${Math.round(data.credits.allowancePercentUsed)}% of allowance used`}</Text>
            </VStack>
          </Section>
          {data.canManage && activeWorkspaceId ? <SpendPerPerson workspaceId={activeWorkspaceId} /> : null}
          <Section title="Plan" footer={<Text>One wallet for the whole workspace, with unlimited members. Change the plan on the web.</Text>}>
            <LabeledContent label="Plan">
              <Text>{data.subscription.planKind === 'paid' ? `$${data.subscription.planAmountCents / 100} a month` : 'No subscription'}</Text>
            </LabeledContent>
            {data.subscription.status ? (
              <LabeledContent label="Status">
                <Text>{sentence(data.subscription.status)}</Text>
              </LabeledContent>
            ) : null}
          </Section>
        </>
      )}
    </Page>
  )
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`

/** Parses "$1,250.50" style input; null when it is not a cap of $0 or more. */
function parseDollars(value: string | undefined): number | null {
  const amount = Number((value ?? '').replace(/[$,]/g, '').trim())
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null
}

/**
 * Workspace → Billing → Spend per person (owners and admins): what each person
 * spent this billing period, their own automations and agents included, and an
 * optional cap that renews every period.
 */
function SpendPerPerson({ workspaceId }: { workspaceId: string }) {
  const ready = useNativeDataReady()
  const run = useScopedAction()
  const spend = useLiveResource(api.billing.memberSpend.members, ready ? { workspaceId } : null)
  const data = spend.data
  if (!data) return null
  const setCap = (person: { userId: string; name: string; capCents: number | null }) =>
    Alert.prompt(
      `Spending cap for ${person.name}`,
      'Dollars per billing period. Everything they start counts, their automations and agents included.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: (value?: string) => {
            const cents = parseDollars(value)
            if (cents === null) {
              Alert.alert('Enter a cap of $0 or more.')
              return
            }
            run('Could not set the cap', (scope) => setMemberSpendCap(scope, person.userId, cents))
          },
        },
      ],
      'plain-text',
      person.capCents === null ? '' : String(person.capCents / 100),
      'decimal-pad',
    )
  return (
    <Section
      title="Spend per person"
      footer={
        <Text>
          {!data.hasBillingAccount
            ? 'Set up billing for this workspace before setting caps.'
            : data.truncated
              ? 'This period has more charges than can be counted here, so some totals are low.'
              : 'This billing period. Tap a person to set or remove their cap.'}
        </Text>
      }
    >
      {data.people.map((person) => {
        const label = (
          <RowLabel
            icon="person"
            title={person.name}
            subtitle={person.capCents === null ? 'No cap' : `Cap ${dollars(person.capCents)} · ${dollars(person.capUsedCents)} used`}
            trailing={<Text modifiers={[secondary]}>{dollars(person.spentCents)}</Text>}
          />
        )
        if (!data.hasBillingAccount) return <React.Fragment key={person.userId}>{label}</React.Fragment>
        return (
          <Menu key={person.userId} label={label}>
            <Button label={person.capCents === null ? 'Set a cap' : 'Change cap'} systemImage="gauge.with.dots.needle.33percent" onPress={() => setCap(person)} />
            {person.capCents !== null ? (
              <Button
                label="Remove cap"
                systemImage="xmark"
                role="destructive"
                onPress={() => run('Could not remove the cap', (scope) => setMemberSpendCap(scope, person.userId, null))}
              />
            ) : null}
          </Menu>
        )
      })}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Shared with me

const SHARED_ICONS: Record<WorkspaceSharedResource['kind'], SymbolName> = {
  conversation: 'bubble.left',
  file: 'doc',
  automation: 'bolt',
  agent: 'sparkles',
}

function SharedPage() {
  const router = useRouter()
  const { activeWorkspaceId } = useWorkspace()
  const [items, setItems] = useState<WorkspaceSharedResource[] | null>(null)
  useEffect(() => {
    if (!activeWorkspaceId) return
    let active = true
    loadSharedWithMe(activeWorkspaceId)
      .then((results) => { if (active) setItems(results) })
      .catch(() => { if (active) setItems([]) })
    return () => { active = false }
  }, [activeWorkspaceId])

  if (items && !items.length) {
    return (
      <>
        <Stack.Screen options={{ title: 'Shared with me', headerLargeTitle: false }} />
        <Empty title="Nothing shared with you yet" systemImage="tray" description="Chats, files, automations and agents shared with you or your teams show up here." />
      </>
    )
  }
  const open = (item: WorkspaceSharedResource) => {
    if (item.kind === 'conversation') router.push({ pathname: '/chat/[id]', params: { id: item.id } })
    else if (item.kind === 'file') router.push(`/files/file/${item.id}` as never)
    else if (item.kind === 'automation') router.push({ pathname: '/automations', params: { id: item.id } })
    else router.push({ pathname: '/agent/[id]', params: { id: item.id } })
  }
  return (
    <Page title="Shared with me">
      <Section footer={items === null ? <Text>Loading…</Text> : undefined}>
        {(items ?? []).map((item) => (
          <Button key={`${item.kind}:${item.id}`} onPress={() => open(item)} modifiers={rowButton}>
            <RowLabel
              icon={SHARED_ICONS[item.kind] ?? 'doc'}
              title={item.title}
              subtitle={[item.sharedVia ? `Shared ${item.sharedVia === 'direct' ? 'with you' : `via ${item.sharedVia}`}` : '', item.accessRole ? sentence(item.accessRole) : ''].filter(Boolean).join(' · ') || undefined}
              trailing={<Symbol systemName="chevron.right" size={13} modifiers={[secondary]} />}
            />
          </Button>
        ))}
      </Section>
    </Page>
  )
}

// ---------------------------------------------------------------------------

export function WorkspaceScreen(): React.ReactElement {
  const { section, id } = useLocalSearchParams<{ section?: string; id?: string }>()
  const { isFeatureEnabled } = useAppSession()
  const { workspacesEnabled } = useWorkspace()
  if (!isFeatureEnabled('workspaces') && !workspacesEnabled) return <FeatureGate title="Workspaces are turned off" />
  switch (section as SectionKey | undefined) {
    case 'people':
    case 'agents':
      return <MembersPage section={section as 'people' | 'agents'} />
    case 'teams':
      return <TeamsPage />
    case 'team':
      return id ? <TeamPage teamId={id} /> : <TeamsPage />
    case 'sharing':
      return <SharingPage />
    case 'billing':
      return <BillingPage />
    case 'shared':
      return <SharedPage />
    default:
      return <WorkspaceHome />
  }
}
