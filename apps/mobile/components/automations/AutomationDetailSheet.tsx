import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import {
  formatAutomationRunError,
  getAutomationConversationId,
  type AutomationRunSummary,
  type AutomationSummary,
} from '@overlay/app-core'
import { useTheme } from '../../hooks/useTheme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { BottomSheet, StatusPill } from '../ui/AppChrome'
import {
  listAutomationRuns,
  runAutomationNow,
  testAutomation,
  type AutomationRunTrigger,
} from '../../services/automationsService'

import { formatSchedule } from '../../lib/automationSchedule'

function runTone(status: string | undefined): 'default' | 'active' | 'danger' {
  if (!status) return 'default'
  if (status === 'failed' || status === 'dead_letter' || status === 'cancelled') return 'danger'
  if (status === 'completed' || status === 'succeeded') return 'active'
  return 'default'
}

export function AutomationDetailSheet({
  visible,
  automation,
  onClose,
  onEdit,
  onOpenRun,
  onOpenChat,
  onTriggerResult,
}: {
  visible: boolean
  automation: AutomationSummary | null
  onClose: () => void
  onEdit: () => void
  onOpenRun: (run: AutomationRunSummary, approvalToken?: string | null) => void
  onOpenChat: (conversationId: string) => void
  /** Called after run-now so the parent can stash the approval token against the run. */
  onTriggerResult?: (result: AutomationRunTrigger) => void
}): React.ReactElement {
  const { theme } = useTheme()
  const [runs, setRuns] = useState<AutomationRunSummary[]>([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [testing, setTesting] = useState(false)

  const loadRuns = useCallback(async () => {
    if (!automation) return
    setRunsLoading(true)
    try {
      setRuns(await listAutomationRuns(automation._id))
    } catch {
      setRuns([])
    } finally {
      setRunsLoading(false)
    }
  }, [automation])

  useEffect(() => {
    if (visible && automation) void loadRuns()
    if (!visible) setRuns([])
  }, [visible, automation, loadRuns])

  async function runNow(): Promise<void> {
    if (!automation) return
    setRunning(true)
    try {
      const result = await runAutomationNow(automation._id)
      if (result.ok === false || result.error) {
        Alert.alert('Could not start run', result.error || result.message || 'Try again.')
        return
      }
      onTriggerResult?.(result)
      await loadRuns()
      if (result.approvalRequired) {
        Alert.alert('Run started', 'This automation will pause for your approval at its condition step.')
      }
    } catch (error) {
      Alert.alert('Could not start run', error instanceof Error ? error.message : 'Try again.')
    } finally {
      setRunning(false)
    }
  }

  async function test(): Promise<void> {
    if (!automation) return
    setTesting(true)
    try {
      const result = await testAutomation(automation._id)
      if (result.success === false || result.error) {
        Alert.alert('Test failed', result.error || result.message || 'Try again.')
        return
      }
      await loadRuns()
      if (result.conversationId) {
        Alert.alert('Test queued', 'The test run will write to the automation chat.', [
          { text: 'Open chat', onPress: () => onOpenChat(result.conversationId!) },
          { text: 'OK', style: 'cancel' },
        ])
      } else {
        Alert.alert('Test queued', 'The test run has been scheduled.')
      }
    } catch (error) {
      Alert.alert('Test failed', error instanceof Error ? error.message : 'Try again.')
    } finally {
      setTesting(false)
    }
  }

  const conversationId = automation ? getAutomationConversationId(automation) : undefined
  const statusLabel = automation?.lastError ? 'Error' : automation?.enabled === false ? 'Paused' : 'Active'
  const statusTone = automation?.lastError ? 'danger' : automation?.enabled === false ? 'default' : 'active'
  const lastError = formatAutomationRunError(automation?.lastError)

  return (
    <BottomSheet theme={theme} visible={visible} onClose={onClose} title={automation?.name || automation?.title || 'Automation'}>
      {!automation ? (
        <ActivityIndicator color={theme.textSecondary} />
      ) : (
        <View style={styles.body}>
          <View style={styles.statusRow}>
            <StatusPill theme={theme} label={statusLabel} tone={statusTone} />
            <Text style={[styles.schedule, { color: theme.textSecondary }]}>{formatSchedule(automation.schedule)}</Text>
          </View>
          <Text style={[styles.meta, { color: theme.textSecondary }]}>
            {automation.timezone || 'UTC'}
            {automation.nextRunAt ? ` · Next ${new Date(automation.nextRunAt).toLocaleString()}` : ''}
            {automation.lastRunAt ? ` · Last ${new Date(automation.lastRunAt).toLocaleString()}` : ''}
          </Text>
          {lastError ? (
            <View style={[styles.errorBox, { borderColor: '#EF4444' }]}>
              <Text style={styles.errorText}>{lastError}</Text>
            </View>
          ) : null}
          {automation.description ? (
            <Text style={[styles.description, { color: theme.text }]}>{automation.description}</Text>
          ) : null}

          <View style={styles.actions}>
            <TouchableOpacity
              onPress={() => void runNow()}
              disabled={running || testing}
              style={[styles.actionChip, { backgroundColor: theme.foreground }]}
            >
              {running ? <ActivityIndicator size="small" color={theme.background} /> : <Feather name="play" size={13} color={theme.background} />}
              <Text style={[styles.actionChipText, { color: theme.background }]}>Run now</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void test()}
              disabled={running || testing}
              style={[styles.actionChip, { borderColor: theme.border }]}
            >
              {testing ? <ActivityIndicator size="small" color={theme.text} /> : <Feather name="check-circle" size={13} color={theme.text} />}
              <Text style={[styles.actionChipText, { color: theme.text }]}>Test</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onEdit} style={[styles.actionChip, { borderColor: theme.border }]}>
              <Feather name="edit-2" size={13} color={theme.text} />
              <Text style={[styles.actionChipText, { color: theme.text }]}>Edit</Text>
            </TouchableOpacity>
            {conversationId ? (
              <TouchableOpacity onPress={() => onOpenChat(conversationId)} style={[styles.actionChip, { borderColor: theme.border }]}>
                <Feather name="message-square" size={13} color={theme.text} />
                <Text style={[styles.actionChipText, { color: theme.text }]}>Open chat</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.runsSection}>
            <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Recent runs</Text>
            <ScrollView style={styles.runsList} nestedScrollEnabled>
              {runsLoading ? (
                <ActivityIndicator color={theme.textSecondary} style={{ paddingVertical: spacing.md }} />
              ) : runs.length === 0 ? (
                <Text style={[styles.runsEmpty, { color: theme.textSecondary }]}>No runs yet.</Text>
              ) : (
                runs.slice(0, 15).map((run) => (
                  <TouchableOpacity
                    key={run._id}
                    onPress={() => onOpenRun(run)}
                    style={[styles.runRow, { borderBottomColor: theme.border }]}
                  >
                    <View style={styles.runCopy}>
                      <Text style={[styles.runStatus, { color: theme.text }]}>{run.status}</Text>
                      <Text style={[styles.runMeta, { color: theme.textSecondary }]}>
                        {new Date(run.scheduledFor).toLocaleString()}
                        {run.triggerSource ? ` · ${run.triggerSource}` : ''}
                      </Text>
                      {formatAutomationRunError(run.errorMessage ?? run.error) ? (
                        <Text style={styles.runError} numberOfLines={1}>
                          {formatAutomationRunError(run.errorMessage ?? run.error)}
                        </Text>
                      ) : null}
                    </View>
                    <Feather name="chevron-right" size={14} color={theme.textSecondary} />
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      )}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  schedule: { fontSize: fontSize.sm },
  meta: { fontSize: fontSize.sm },
  errorBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.lg, padding: spacing.md },
  errorText: { color: '#EF4444', fontSize: fontSize.sm, lineHeight: 19 },
  description: { fontSize: fontSize.sm, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actionChip: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: borderRadius.full, borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent', flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionChipText: { fontSize: fontSize.sm, fontWeight: '600' },
  runsSection: { gap: spacing.sm },
  sectionLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 },
  runsList: { maxHeight: 280 },
  runsEmpty: { fontSize: fontSize.sm, paddingVertical: spacing.md },
  runRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  runCopy: { flex: 1, gap: 2 },
  runStatus: { fontSize: fontSize.sm, fontWeight: '600', textTransform: 'capitalize' },
  runMeta: { fontSize: 11 },
  runError: { color: '#EF4444', fontSize: 11 },
})
