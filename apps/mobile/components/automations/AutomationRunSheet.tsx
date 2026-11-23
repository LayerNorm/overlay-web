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
import type { AutomationRunEvent, AutomationRunSummary } from '@overlay/app-core'
import { formatAutomationRunError } from '@overlay/app-core'
import { useTheme } from '../../hooks/useTheme'
import { useAuth } from '../../contexts/AuthContext'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { StatusPill } from '../ui/AppChrome'
import { NativePageSheet } from '../ui/NativePageSheet'
import {
  approveAutomationRun,
  cancelAutomationRun,
  subscribeAutomationRuns,
  retryAutomationRun,
  subscribeWorkflowSteps,
} from '../../services/automationsService'

const TERMINAL = new Set(['completed', 'succeeded', 'failed', 'cancelled', 'skipped', 'dead_letter'])

function statusTone(status: string | undefined): 'default' | 'active' | 'danger' {
  if (!status) return 'default'
  if (status === 'failed' || status === 'dead_letter' || status === 'cancelled') return 'danger'
  if (status === 'completed' || status === 'succeeded') return 'active'
  return 'default'
}

function eventIcon(eventType: string): keyof typeof Feather.glyphMap {
  if (eventType.includes('failed') || eventType.includes('error')) return 'x-circle'
  if (eventType.includes('completed') || eventType.includes('succeeded')) return 'check-circle'
  if (eventType.includes('started') || eventType.includes('created')) return 'play-circle'
  if (eventType.includes('hook')) return 'pause-circle'
  return 'circle'
}

function shortStepName(stepName: string | undefined): string {
  if (!stepName) return ''
  // Workflow step names arrive as `step//./workflows/...//executeAutomationRun`.
  const tail = stepName.split('//').filter(Boolean)
  return tail[tail.length - 1] ?? stepName
}

export function AutomationRunSheet({
  visible,
  automationId,
  run,
  approvalToken,
  onClose,
  onOpenChat,
  onChanged,
}: {
  visible: boolean
  automationId: string
  run: AutomationRunSummary | null
  /** Present when this client triggered the run and the graph asked for approval. */
  approvalToken?: string | null
  onClose: () => void
  onOpenChat: (conversationId: string) => void
  onChanged: () => void
}): React.ReactElement {
  const { theme } = useTheme()
  const { session } = useAuth()
  const { activeWorkspaceId } = useWorkspace()
  const [liveStatus, setLiveStatus] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [events, setEvents] = useState<AutomationRunEvent[]>([])
  const [streamFailed, setStreamFailed] = useState(false)
  const [acting, setActing] = useState<'cancel' | 'retry' | 'approve' | 'deny' | null>(null)

  const workflowRunId = run?.workflowRunId
  const runId = run?._id
  const initialConversationId = run?.conversationId
  const userId = session?.user.id
  const accessToken = session?.accessToken
  const status = liveStatus ?? run?.status
  const isTerminal = TERMINAL.has(status ?? '')

  useEffect(() => {
    if (!visible || !runId || !activeWorkspaceId) return
    setLiveStatus(null)
    setStatusError(null)
    setConversationId(initialConversationId ?? null)
    setEvents([])
    setStreamFailed(false)
    let active = true
    const stops: Array<() => void> = []
    const fail = () => { if (active) setStreamFailed(true) }
    try {
      stops.push(subscribeAutomationRuns(activeWorkspaceId, automationId, rows => {
        if (!active) return
        const snapshot = rows.find(row => row._id === runId)
        if (snapshot) { setLiveStatus(snapshot.status); setStatusError(snapshot.error ?? null); setConversationId(snapshot.conversationId ?? null) }
      }, fail))
      if (workflowRunId && userId && accessToken) stops.push(subscribeWorkflowSteps({ workflowRunId, userId, accessToken }, rows => { if (active) setEvents(rows) }, fail))
    } catch { fail() }
    return () => { active = false; stops.forEach(stop => stop()) }
  }, [visible, runId, initialConversationId, automationId, workflowRunId, activeWorkspaceId, userId, accessToken])

  const act = useCallback(async (kind: 'cancel' | 'retry' | 'approve' | 'deny') => {
    if (!run) return
    setActing(kind)
    try {
      if (kind === 'cancel') {
        await cancelAutomationRun(automationId, run._id)
      } else if (kind === 'retry') {
        await retryAutomationRun(automationId, run._id)
      } else if (approvalToken) {
        await approveAutomationRun(automationId, {
          token: approvalToken,
          approved: kind === 'approve',
        })
      }
      onChanged()
    } catch (error) {
      Alert.alert('Action failed', error instanceof Error ? error.message : 'Try again.')
    } finally {
      setActing(null)
    }
  }, [run, automationId, approvalToken, onChanged])

  const errorText = formatAutomationRunError(statusError ?? run?.errorMessage ?? run?.error)

  return (
    <NativePageSheet title="Run details" visible={visible} onClose={onClose}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
      {!run ? (
        <ActivityIndicator color={theme.textSecondary} />
      ) : (
        <View style={styles.body}>
          <View style={styles.statusRow}>
            <StatusPill theme={theme} label={status ?? 'queued'} tone={statusTone(status)} />
            <Text style={[styles.timeText, { color: theme.textSecondary }]}>
              {new Date(run.scheduledFor).toLocaleString()}
            </Text>
          </View>
          {run.startedAt ? (
            <Text style={[styles.meta, { color: theme.textSecondary }]}>
              Started {new Date(run.startedAt).toLocaleTimeString()}
              {run.completedAt || run.finishedAt
                ? ` · Finished ${new Date((run.completedAt ?? run.finishedAt)!).toLocaleTimeString()}`
                : ''}
              {run.triggerSource ? ` · ${run.triggerSource}` : ''}
            </Text>
          ) : null}
          {errorText ? (
            <View style={[styles.errorBox, { borderColor: '#EF4444' }]}>
              <Text style={styles.errorText}>{errorText}</Text>
            </View>
          ) : null}
          {run.resultSummary ? (
            <Text style={[styles.summary, { color: theme.text }]} numberOfLines={6}>{run.resultSummary}</Text>
          ) : null}

          {approvalToken && !isTerminal ? (
            <View style={[styles.approvalCard, { borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}>
              <Text style={[styles.approvalTitle, { color: theme.text }]}>This run needs your approval</Text>
              <Text style={[styles.approvalCopy, { color: theme.textSecondary }]}>
                The workflow paused at a condition step. Approve to let it continue, or deny to stop it.
              </Text>
              <View style={styles.approvalActions}>
                <TouchableOpacity
                  onPress={() => void act('approve')}
                  disabled={acting !== null}
                  style={[styles.approveButton, { backgroundColor: theme.foreground }]}
                >
                  {acting === 'approve' ? <ActivityIndicator color={theme.background} size="small" /> : <Text style={[styles.approveText, { color: theme.background }]}>Approve</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => void act('deny')}
                  disabled={acting !== null}
                  style={[styles.denyButton, { borderColor: theme.border }]}
                >
                  {acting === 'deny' ? <ActivityIndicator color={theme.text} size="small" /> : <Text style={[styles.denyText, { color: theme.text }]}>Deny</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          <View style={styles.actions}>
            {!isTerminal ? (
              <TouchableOpacity
                onPress={() => void act('cancel')}
                disabled={acting !== null}
                style={[styles.actionChip, { borderColor: '#EF4444' }]}
              >
                {acting === 'cancel' ? <ActivityIndicator size="small" color="#EF4444" /> : <Text style={styles.cancelText}>Cancel run</Text>}
              </TouchableOpacity>
            ) : (status === 'failed' || status === 'cancelled') ? (
              <TouchableOpacity
                onPress={() => void act('retry')}
                disabled={acting !== null}
                style={[styles.actionChip, { borderColor: theme.border }]}
              >
                {acting === 'retry' ? <ActivityIndicator size="small" color={theme.text} /> : <Text style={[styles.actionChipText, { color: theme.text }]}>Retry run</Text>}
              </TouchableOpacity>
            ) : null}
            {conversationId ? (
              <TouchableOpacity
                onPress={() => onOpenChat(conversationId)}
                style={[styles.actionChip, { borderColor: theme.border }]}
              >
                <Feather name="message-square" size={13} color={theme.text} />
                <Text style={[styles.actionChipText, { color: theme.text }]}>Open chat</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {workflowRunId ? (
            <View style={styles.eventsSection}>
              <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
                Events{!isTerminal && !streamFailed ? ' · live' : ''}
              </Text>
              <ScrollView style={styles.eventsList} nestedScrollEnabled>
                {events.length === 0 ? (
                  <Text style={[styles.eventsEmpty, { color: theme.textSecondary }]}>
                    {streamFailed ? 'Live step events unavailable.' : 'No step events yet. Status updates live.'}
                  </Text>
                ) : (
                  events.map((event) => (
                    <View key={event.eventId} style={[styles.eventRow, { borderBottomColor: theme.border }]}>
                      <Feather
                        name={eventIcon(event.eventType)}
                        size={13}
                        color={event.eventType.includes('failed') ? '#EF4444' : theme.textSecondary}
                      />
                      <View style={styles.eventCopy}>
                        <Text style={[styles.eventTitle, { color: theme.text }]} numberOfLines={2}>
                          {event.stepName ? shortStepName(event.stepName) : event.eventType}
                          {event.attempt && event.attempt > 1 ? ` · attempt ${event.attempt}` : ''}
                        </Text>
                        <Text style={[styles.eventMeta, { color: theme.textSecondary }]}>
                          {event.eventType} · {new Date(event.createdAt).toLocaleTimeString()}
                        </Text>
                        {event.error ? (
                          <Text style={styles.eventError} numberOfLines={3}>{event.error}</Text>
                        ) : null}
                      </View>
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          ) : null}
        </View>
      )}
      </ScrollView>
    </NativePageSheet>
  )
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timeText: { fontSize: fontSize.sm },
  meta: { fontSize: fontSize.sm },
  errorBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.lg, padding: spacing.md },
  errorText: { color: '#EF4444', fontSize: fontSize.sm, lineHeight: 19 },
  summary: { fontSize: fontSize.sm, lineHeight: 20 },
  approvalCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.xl, padding: spacing.md, gap: spacing.sm },
  approvalTitle: { fontSize: fontSize.sm, fontWeight: '700' },
  approvalCopy: { fontSize: fontSize.sm, lineHeight: 19 },
  approvalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  approveButton: { flex: 1, minHeight: 40, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center' },
  approveText: { fontSize: fontSize.sm, fontWeight: '700' },
  denyButton: { flex: 1, minHeight: 40, borderRadius: borderRadius.full, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  denyText: { fontSize: fontSize.sm, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actionChip: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: borderRadius.full, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionChipText: { fontSize: fontSize.sm, fontWeight: '600' },
  cancelText: { color: '#EF4444', fontSize: fontSize.sm, fontWeight: '600' },
  eventsSection: { gap: spacing.sm },
  sectionLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 },
  eventsList: { maxHeight: 280 },
  eventsEmpty: { fontSize: fontSize.sm, paddingVertical: spacing.md },
  eventRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, alignItems: 'flex-start' },
  eventCopy: { flex: 1, gap: 2 },
  eventTitle: { fontSize: fontSize.sm, fontWeight: '600' },
  eventMeta: { fontSize: 11 },
  eventError: { color: '#EF4444', fontSize: 11, lineHeight: 15 },
})
