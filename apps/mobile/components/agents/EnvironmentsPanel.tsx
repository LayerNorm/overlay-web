/**
 * Agent environments — connected machines running BYO harnesses.
 *
 * Mirrors web `AgentEnvironmentSettings`: env list with faster polling while
 * anything is pending, approve-with-roots for pending environments, roots
 * editing, revoke, and an offline recovery hint with the persistent-service
 * command for macOS hosts. "Connect a machine" runs the enrollment flow in
 * `ConnectMachineSheet`, then lands on the pending environment's approve
 * sheet.
 */
import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { hapticNotify } from '../../lib/haptics'
import type { Theme } from '../../constants/theme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { BottomSheet, EmptyState } from '../ui/AppChrome'
import { Badge, ListRow, Section } from '../ui/primitives'
import { AppIcon } from '../ui/AppIcon'
import { ConnectMachineSheet } from './ConnectMachineSheet'
import {
  approveAgentEnvironment,
  listAgentEnvironments,
  revokeAgentEnvironment,
  updateEnvironmentRoots,
  type AgentEnvironmentItem,
} from '../../services/agentsService'
import { parseRoots } from '../../lib/agentByo'

// Keep in sync with OVERLAY_AGENT_HOST_PACKAGE_VERSION in web
// src/server/agents/agent-enrollment-command.ts.
const HOST_PACKAGE_SPEC = '@layernorm/overlay-agent-host@0.3.5'
const DEFAULT_HOST_CONFIG_PATH = '~/.overlay/agent-host/config.json'

function persistentServiceCommand(environment: AgentEnvironmentItem): string | null {
  if (environment.kind === 'overlay_cloud') return null
  if (!environment.platform?.startsWith('darwin')) return null
  return `npx --yes --package node@24 --package ${HOST_PACKAGE_SPEC} overlay-agent-host service install --config ${DEFAULT_HOST_CONFIG_PATH}`
}

function lastSeenLabel(lastSeenAt: number) {
  const elapsed = Math.max(0, Date.now() - lastSeenAt)
  if (elapsed < 60_000) return 'seen just now'
  if (elapsed < 60 * 60_000) return `seen ${Math.floor(elapsed / 60_000)}m ago`
  if (elapsed < 24 * 60 * 60_000) return `seen ${Math.floor(elapsed / (24 * 60 * 60_000))}h ago`
  return `seen ${Math.floor(elapsed / (24 * 60 * 60_000))}d ago`
}

function environmentSubtitle(environment: AgentEnvironmentItem): string {
  const parts = [environment.platform ?? environment.kind]
  if (environment.hostVersion) parts.push(`host ${environment.hostVersion}`)
  if (environment.lastSeenAt) parts.push(lastSeenLabel(environment.lastSeenAt))
  return parts.join(' · ')
}

function statusTone(status: AgentEnvironmentItem['status']): 'default' | 'accent' | 'danger' {
  if (status === 'revoked') return 'danger'
  if (status === 'online') return 'accent'
  return 'default'
}

export function EnvironmentsPanel({
  theme,
  workspaceId,
  connectedAgentsEnabled,
}: {
  theme: Theme
  workspaceId: string
  connectedAgentsEnabled: boolean
}): React.ReactElement {
  const [environments, setEnvironments] = useState<AgentEnvironmentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AgentEnvironmentItem | null>(null)
  const [rootsText, setRootsText] = useState('')
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [connectOpen, setConnectOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const list = await listAgentEnvironments(workspaceId)
      setEnvironments(list)
      setError(null)
      return list
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load environments')
      return []
    }
  }, [workspaceId])

  useEffect(() => {
    setLoading(true)
    void refresh().finally(() => setLoading(false))
  }, [refresh])

  // Poll faster while anything is pending so approvals land quickly.
  const hasPending = environments.some((environment) => environment.status === 'pending')
  useEffect(() => {
    if (!hasPending) return
    const timer = setInterval(() => void refresh(), 3_000)
    return () => clearInterval(timer)
  }, [hasPending, refresh])

  const copy = useCallback(async (field: string, value: string) => {
    await Clipboard.setStringAsync(value)
    hapticNotify()
    setCopiedField(field)
    setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 1_500)
  }, [])

  const approve = useCallback(async (environment: AgentEnvironmentItem) => {
    const roots = parseRoots(rootsText || (environment.kind === 'overlay_cloud' ? '/workspace' : ''))
    if (roots.length === 0) {
      setError('Enter at least one absolute project root.')
      return
    }
    setBusyId(environment.id)
    setError(null)
    try {
      await approveAgentEnvironment(workspaceId, environment.id, { mode: 'selected_roots', roots })
      setDetail(null)
      await refresh()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Approval failed.')
    } finally {
      setBusyId(null)
    }
  }, [refresh, rootsText, workspaceId])

  const saveRoots = useCallback(async (environment: AgentEnvironmentItem) => {
    const roots = parseRoots(rootsText)
    if (roots.length === 0) {
      setError('Enter at least one absolute project root.')
      return
    }
    setBusyId(environment.id)
    setError(null)
    try {
      await updateEnvironmentRoots(workspaceId, environment.id, { mode: 'selected_roots', roots })
      setDetail(null)
      await refresh()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Project root update failed.')
    } finally {
      setBusyId(null)
    }
  }, [refresh, rootsText, workspaceId])

  const confirmRevoke = useCallback((environment: AgentEnvironmentItem) => {
    Alert.alert(
      `Revoke ${environment.name}?`,
      'This environment loses access immediately. Agents bound to it stop running there.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: () => {
            setBusyId(environment.id)
            setError(null)
            void revokeAgentEnvironment(workspaceId, environment.id)
              .then(async () => {
                setDetail(null)
                await refresh()
              })
              .catch((nextError) => {
                setError(nextError instanceof Error ? nextError.message : 'Revocation failed.')
              })
              .finally(() => setBusyId(null))
          },
        },
      ],
    )
  }, [refresh, workspaceId])

  const openDetail = useCallback((environment: AgentEnvironmentItem) => {
    setDetail(environment)
    setRootsText(
      environment.filesystemGrant?.mode === 'selected_roots'
        ? environment.filesystemGrant.roots.join('\n')
        : environment.kind === 'overlay_cloud' ? '/workspace' : '',
    )
  }, [])

  if (!connectedAgentsEnabled) {
    return (
      <EmptyState
        theme={theme}
        icon="server"
        title="Connected agents are off"
        description="This deployment doesn't allow machines to connect as agent environments."
      />
    )
  }

  const serviceCommand = detail ? persistentServiceCommand(detail) : null

  return (
    <View style={styles.panel}>
      {error ? (
        <View style={[styles.errorBanner, { borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}>
          <Text style={[styles.errorText, { color: '#EF4444' }]}>{error}</Text>
        </View>
      ) : null}

      <Section theme={theme}>
        <ListRow
          theme={theme}
          title="Connect a machine"
          subtitle="Run Codex, Claude Code, or Hermes on your own hardware"
          icon="plus"
          iconSfSymbol="plus"
          showChevron
          onPress={() => setConnectOpen(true)}
        />
      </Section>

      {loading ? (
        <ActivityIndicator color={theme.textSecondary} style={styles.loading} />
      ) : environments.length === 0 ? (
        <EmptyState
          theme={theme}
          icon="server"
          title="No environments connected"
          description="Connect a computer, VPS, or sandbox so agents can run your own harnesses there."
        />
      ) : (
        <Section theme={theme} label="Connected">
          {environments.map((environment) => (
            <ListRow
              key={environment.id}
              theme={theme}
              title={environment.name}
              subtitle={environmentSubtitle(environment)}
              icon="server"
              iconSfSymbol="server.rack"
              accessory={<Badge theme={theme} label={environment.status} tone={statusTone(environment.status)} />}
              showChevron
              onPress={() => openDetail(environment)}
            />
          ))}
        </Section>
      )}

      <ConnectMachineSheet
        theme={theme}
        visible={connectOpen}
        workspaceId={workspaceId}
        onClose={() => setConnectOpen(false)}
        onConnected={(environment) => {
          setConnectOpen(false)
          openDetail(environment)
        }}
      />

      {/* Environment detail / approve / roots / revoke */}
      <BottomSheet
        theme={theme}
        visible={detail !== null}
        onClose={() => setDetail(null)}
        title={detail?.name ?? 'Environment'}
      >
        {detail ? (
          <View style={styles.sheetBody}>
            <View style={styles.detailHeader}>
              <Text style={[styles.detailMeta, { color: theme.textSecondary }]}>
                {environmentSubtitle(detail)}
              </Text>
              <Badge theme={theme} label={detail.status} tone={statusTone(detail.status)} />
            </View>

            {detail.status === 'pending' ? (
              <View style={styles.block}>
                <View style={[styles.verifyRow, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}>
                  <AppIcon sfSymbol="checkmark.shield" featherIcon="shield" size={16} color={theme.textSecondary} />
                  <Text style={[styles.verifyText, { color: theme.text }]}>
                    Verify phrase: <Text style={styles.strong}>{detail.verificationPhrase ?? 'waiting…'}</Text>
                  </Text>
                </View>
                <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>
                  Approved project roots, one per line
                </Text>
                <TextInput
                  value={rootsText}
                  onChangeText={setRootsText}
                  placeholder={detail.kind === 'overlay_cloud' ? '/workspace' : '/Users/you/Projects'}
                  placeholderTextColor={theme.textDisabled}
                  multiline
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.rootsInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
                />
                <Text style={[styles.fieldHint, { color: theme.textSecondary }]}>
                  Overlay can dispatch work only inside these explicit roots. You can change or revoke access later.
                </Text>
                <TouchableOpacity
                  onPress={() => void approve(detail)}
                  disabled={busyId !== null || !detail.verificationPhrase}
                  style={[styles.primaryButton, { backgroundColor: theme.foreground, opacity: busyId || !detail.verificationPhrase ? 0.5 : 1 }]}
                  accessibilityRole="button"
                >
                  {busyId === detail.id ? (
                    <ActivityIndicator size="small" color={theme.background} />
                  ) : (
                    <Text style={[styles.primaryButtonText, { color: theme.background }]}>Approve environment</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}

            {detail.status !== 'pending' && detail.status !== 'revoked' ? (
              <View style={styles.block}>
                <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Filesystem access</Text>
                <TextInput
                  value={rootsText}
                  onChangeText={setRootsText}
                  placeholder="/Users/you/Projects"
                  placeholderTextColor={theme.textDisabled}
                  multiline
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.rootsInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
                />
                <Text style={[styles.fieldHint, { color: theme.textSecondary }]}>
                  {detail.filesystemGrant?.mode === 'all_user_files'
                    ? 'This environment currently has access to all user files. Saving narrows it to the roots above.'
                    : 'Approved project roots, one per line.'}
                </Text>
                <TouchableOpacity
                  onPress={() => void saveRoots(detail)}
                  disabled={busyId !== null}
                  style={[styles.secondaryButton, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
                  accessibilityRole="button"
                >
                  {busyId === detail.id ? (
                    <ActivityIndicator size="small" color={theme.text} />
                  ) : (
                    <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Save roots</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}

            {detail.status === 'offline' ? (
              <View style={[styles.offlineHint, { borderColor: 'rgba(217,119,6,0.35)', backgroundColor: 'rgba(217,119,6,0.08)' }]}>
                <Text style={[styles.offlineText, { color: theme.text }]}>
                  {detail.kind === 'overlay_cloud'
                    ? 'This managed environment is unreachable. Queued work will resume when it recovers.'
                    : 'This machine is offline — it may be asleep, or its connector was closed. Overlay can’t wake it remotely: start the connector on that machine and anything still queued will pick up on its own.'}
                </Text>
                {serviceCommand ? (
                  <TouchableOpacity
                    onPress={() => void copy('service', serviceCommand)}
                    style={[styles.commandBox, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
                    accessibilityRole="button"
                    accessibilityLabel="Copy persistent service command"
                  >
                    <Text style={[styles.commandText, { color: theme.textSecondary }]} numberOfLines={3}>
                      {serviceCommand}
                    </Text>
                    <AppIcon
                      sfSymbol={copiedField === 'service' ? 'checkmark' : 'doc.on.doc'}
                      featherIcon={copiedField === 'service' ? 'check' : 'copy'}
                      size={14}
                      color={theme.textSecondary}
                    />
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            {detail.status !== 'revoked' ? (
              <TouchableOpacity
                onPress={() => confirmRevoke(detail)}
                disabled={busyId !== null}
                style={[styles.dangerButton, { borderColor: 'rgba(239,68,68,0.4)' }]}
                accessibilityRole="button"
              >
                <Text style={styles.dangerButtonText}>Revoke environment</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </BottomSheet>
    </View>
  )
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md },
  loading: { marginTop: spacing.xl },
  errorBanner: {
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  errorText: { fontSize: fontSize.sm },
  sheetBody: { gap: spacing.md, paddingBottom: spacing.md },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  detailMeta: { fontSize: fontSize.sm, flex: 1 },
  block: { gap: spacing.sm },
  verifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  verifyText: { fontSize: fontSize.sm },
  strong: { fontWeight: '700' },
  fieldLabel: { fontSize: fontSize.xs, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldHint: { fontSize: fontSize.xs, lineHeight: 16 },
  rootsInput: {
    minHeight: 72,
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    fontSize: fontSize.sm,
    textAlignVertical: 'top',
  },
  offlineHint: {
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.sm,
  },
  offlineText: { fontSize: fontSize.xs, lineHeight: 17 },
  commandBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  commandText: { flex: 1, fontSize: 11, fontFamily: 'Menlo', lineHeight: 15 },
  primaryButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm + 3,
    borderRadius: borderRadius.full,
  },
  primaryButtonText: { fontSize: fontSize.sm, fontWeight: '600' },
  secondaryButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryButtonText: { fontSize: fontSize.sm, fontWeight: '600' },
  dangerButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dangerButtonText: { color: '#EF4444', fontSize: fontSize.sm, fontWeight: '600' },
})
