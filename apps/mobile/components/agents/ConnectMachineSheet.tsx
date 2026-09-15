/**
 * "Connect a machine" sheet — pick a BYO harness, get the one-line enrollment
 * command, and poll until the machine checks in as a pending environment.
 * `onConnected` fires with the fresh pending environment so the caller can
 * route it into the approve flow.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import type { BuiltInUserOwnedAcpAdapterId } from '@overlay/workspace-contracts'
import type { Theme } from '../../constants/theme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { BottomSheet } from '../ui/AppChrome'
import { AppIcon } from '../ui/AppIcon'
import {
  createAgentEnrollment,
  listAgentEnvironments,
  type AgentEnvironmentItem,
} from '../../services/agentsService'
import { BUILT_IN_BYO_HARNESSES } from '../../lib/agentByo'

export function ConnectMachineSheet({
  theme,
  visible,
  workspaceId,
  onClose,
  onConnected,
}: {
  theme: Theme
  visible: boolean
  workspaceId: string
  onClose: () => void
  onConnected: (environment: AgentEnvironmentItem) => void
}): React.ReactElement {
  const [adapterId, setAdapterId] = useState<BuiltInUserOwnedAcpAdapterId>('codex')
  const [command, setCommand] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const baselineIds = useRef<Set<string>>(new Set())

  // Poll for the machine running the command — it shows up as a new pending
  // environment that wasn't in the baseline captured when we enrolled.
  useEffect(() => {
    if (!command || !visible) return
    const timer = setInterval(() => {
      void listAgentEnvironments(workspaceId).then((list) => {
        const fresh = list
          .filter((environment) => environment.status === 'pending' && !baselineIds.current.has(environment.id))
          .sort((a, b) => b.createdAt - a.createdAt)[0]
        if (fresh) {
          setCommand('')
          onConnected(fresh)
        }
      }).catch(() => undefined)
    }, 2_500)
    return () => clearInterval(timer)
  }, [command, visible, workspaceId, onConnected])

  const begin = useCallback(async () => {
    setBusy(true)
    setError(null)
    setCommand('')
    try {
      baselineIds.current = new Set(
        (await listAgentEnvironments(workspaceId)).map((environment) => environment.id),
      )
      const session = await createAgentEnrollment(workspaceId, adapterId)
      setCommand(session.command)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not create the connection command.')
    } finally {
      setBusy(false)
    }
  }, [adapterId, workspaceId])

  const copy = useCallback(async () => {
    if (!command) return
    await Clipboard.setStringAsync(command)
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setCopied(true)
    setTimeout(() => setCopied(false), 1_500)
  }, [command])

  const close = useCallback(() => {
    setCommand('')
    setError(null)
    onClose()
  }, [onClose])

  return (
    <BottomSheet theme={theme} visible={visible} onClose={close} title="Connect a machine">
      <View style={styles.body}>
        <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Harness</Text>
        <View style={styles.adapterList}>
          {BUILT_IN_BYO_HARNESSES.map((harness) => {
            const active = adapterId === harness.id
            return (
              <TouchableOpacity
                key={harness.id}
                onPress={() => { setAdapterId(harness.id); setCommand('') }}
                style={[styles.adapterRow, { borderColor: theme.border, backgroundColor: active ? theme.surfaceSubtle : 'transparent' }]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <View style={styles.adapterBody}>
                  <Text style={[styles.adapterLabel, { color: theme.text }]}>{harness.label}</Text>
                  <Text style={[styles.adapterDesc, { color: theme.textSecondary }]}>{harness.description}</Text>
                </View>
                {active ? <AppIcon sfSymbol="checkmark" featherIcon="check" size={16} color={theme.text} /> : null}
              </TouchableOpacity>
            )
          })}
        </View>

        {error ? <Text style={[styles.errorText, { color: '#EF4444' }]}>{error}</Text> : null}

        {!command ? (
          <TouchableOpacity
            onPress={() => void begin()}
            disabled={busy}
            style={[styles.primaryButton, { backgroundColor: theme.foreground, opacity: busy ? 0.5 : 1 }]}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator size="small" color={theme.background} />
            ) : (
              <Text style={[styles.primaryButtonText, { color: theme.background }]}>Create connection command</Text>
            )}
          </TouchableOpacity>
        ) : (
          <View style={styles.commandBlock}>
            <Text style={[styles.fieldHint, { color: theme.textSecondary }]}>
              Run this on the machine — the connector is outbound-only and opens no ports. It checks in here automatically.
            </Text>
            <TouchableOpacity
              onPress={() => void copy()}
              style={[styles.commandBox, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
              accessibilityRole="button"
              accessibilityLabel="Copy connection command"
            >
              <Text style={[styles.commandText, { color: theme.text }]} selectable numberOfLines={6}>
                {command}
              </Text>
              <AppIcon
                sfSymbol={copied ? 'checkmark' : 'doc.on.doc'}
                featherIcon={copied ? 'check' : 'copy'}
                size={14}
                color={theme.textSecondary}
              />
            </TouchableOpacity>
            <View style={styles.waitingRow}>
              <ActivityIndicator size="small" color={theme.textSecondary} />
              <Text style={[styles.fieldHint, { color: theme.textSecondary }]}>
                Waiting for the machine to check in…
              </Text>
            </View>
          </View>
        )}
      </View>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  body: { gap: spacing.md, paddingBottom: spacing.md },
  fieldLabel: { fontSize: fontSize.xs, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldHint: { fontSize: fontSize.xs, lineHeight: 16 },
  errorText: { fontSize: fontSize.sm },
  adapterList: { gap: spacing.sm },
  adapterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  adapterBody: { flex: 1, gap: 2 },
  adapterLabel: { fontSize: fontSize.md, fontWeight: '600' },
  adapterDesc: { fontSize: fontSize.xs, lineHeight: 16 },
  commandBlock: { gap: spacing.sm },
  commandBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  commandText: { flex: 1, fontSize: 11, fontFamily: 'Menlo', lineHeight: 15 },
  waitingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  primaryButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm + 3,
    borderRadius: borderRadius.full,
  },
  primaryButtonText: { fontSize: fontSize.sm, fontWeight: '600' },
})
