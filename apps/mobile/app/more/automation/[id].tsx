import React, { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { useTheme } from '../../../hooks/useTheme'
import { borderRadius, fontSize, spacing } from '../../../constants/theme'
import { PanelCard, SectionLabel } from '../../../components/ui/PanelPrimitives'
import {
  getAutomationRunDetail,
  listAutomationRuns,
  listAutomations,
  retryAutomationRun,
  runAutomation,
} from '../../../services/automationsService'
import type {
  AutomationRunDetail,
  AutomationRunSummary,
  AutomationSummary,
} from '../../../services/appContracts'

function formatTimestamp(timestamp?: number): string {
  if (!timestamp) return 'Not available'
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function AutomationDetailScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { theme } = useTheme()
  const [automation, setAutomation] = useState<AutomationSummary | null>(null)
  const [runs, setRuns] = useState<AutomationRunSummary[]>([])
  const [selectedRunDetail, setSelectedRunDetail] = useState<AutomationRunDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRunning, setIsRunning] = useState(false)
  const [retryingRunId, setRetryingRunId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const [automations, nextRuns] = await Promise.all([
        listAutomations().catch(() => []),
        listAutomationRuns(id).catch(() => []),
      ])
      const currentAutomation = automations.find((item) => item._id === id) || null
      setAutomation(currentAutomation)
      setRuns(nextRuns)
      if (nextRuns[0]) {
        const detail = await getAutomationRunDetail(nextRuns[0]._id).catch(() => null)
        setSelectedRunDetail(detail)
      } else {
        setSelectedRunDetail(null)
      }
    } finally {
      setIsLoading(false)
    }
  }, [id])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  const latestRun = useMemo(() => runs[0] || null, [runs])

  if (isLoading || !automation) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backRow}>
          <Feather name="chevron-left" size={18} color={theme.textSecondary} />
          <Text style={[styles.backText, { color: theme.textSecondary }]}>Automations</Text>
        </TouchableOpacity>

        <SectionLabel theme={theme}>Automation</SectionLabel>
        <Text style={[styles.title, { color: theme.text }]}>{automation.title}</Text>
        <Text style={[styles.description, { color: theme.textSecondary }]}>
          {automation.description || 'Scheduled workflow'}
        </Text>

        <PanelCard theme={theme}>
          <View style={styles.metricGrid}>
            <View style={[styles.metricCard, { backgroundColor: theme.background, borderColor: theme.border }]}>
              <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Mode</Text>
              <Text style={[styles.metricValue, { color: theme.text }]}>{automation.mode}</Text>
            </View>
            <View style={[styles.metricCard, { backgroundColor: theme.background, borderColor: theme.border }]}>
              <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Status</Text>
              <Text style={[styles.metricValue, { color: theme.text }]}>{automation.status}</Text>
            </View>
          </View>
          <Text style={[styles.caption, { color: theme.textSecondary }]}>
            {automation.scheduleKind} · {automation.timezone} · Next run {formatTimestamp(automation.nextRunAt)}
          </Text>
          {automation.readinessMessage ? (
            <Text style={[styles.caption, { color: theme.textSecondary }]}>{automation.readinessMessage}</Text>
          ) : null}
          <TouchableOpacity
            onPress={() => {
              setIsRunning(true)
              void runAutomation(automation._id).finally(() => {
                setIsRunning(false)
                void refresh()
              })
            }}
            style={[styles.primaryButton, { backgroundColor: theme.buttonBg }]}
          >
            <Text style={[styles.primaryButtonText, { color: theme.surface }]}>
              {isRunning ? 'Running…' : 'Run now'}
            </Text>
          </TouchableOpacity>
        </PanelCard>

        <PanelCard theme={theme} padded={false}>
          <View style={[styles.sectionHeader, { borderBottomColor: theme.border }]}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Run history</Text>
          </View>
          {runs.length > 0 ? (
            runs.map((run, index) => (
              <TouchableOpacity
                key={run._id}
                onPress={() => {
                  void getAutomationRunDetail(run._id).then((detail) => setSelectedRunDetail(detail))
                }}
                style={[
                  styles.row,
                  { borderBottomColor: index === runs.length - 1 ? 'transparent' : theme.border },
                ]}
              >
                <View style={styles.rowBody}>
                  <Text style={[styles.rowTitle, { color: theme.text }]}>
                    {run.status} · {run.triggerSource}
                  </Text>
                  <Text style={[styles.rowMeta, { color: theme.textSecondary }]}>
                    {formatTimestamp(run.startedAt || run.createdAt)}
                  </Text>
                  {run.resultSummary ? (
                    <Text style={[styles.rowCaption, { color: theme.textDisabled }]} numberOfLines={2}>
                      {run.resultSummary}
                    </Text>
                  ) : null}
                </View>
                {(run.status === 'failed' || run.status === 'timed_out') ? (
                  <TouchableOpacity
                    onPress={() => {
                      setRetryingRunId(run._id)
                      void retryAutomationRun(run._id).finally(() => {
                        setRetryingRunId(null)
                        void refresh()
                      })
                    }}
                    style={[styles.retryButton, { borderColor: theme.border }]}
                  >
                    <Text style={[styles.retryButtonText, { color: theme.text }]}>
                      {retryingRunId === run._id ? 'Retrying…' : 'Retry'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Feather name="clock" size={24} color={theme.textSecondary} />
              <Text style={[styles.emptyTitle, { color: theme.text }]}>No runs yet</Text>
            </View>
          )}
        </PanelCard>

        {selectedRunDetail || latestRun ? (
          <PanelCard theme={theme}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Selected run</Text>
            <Text style={[styles.caption, { color: theme.textSecondary }]}>
              {formatTimestamp(selectedRunDetail?.run.startedAt || latestRun?.startedAt || latestRun?.createdAt)}
            </Text>
            <Text style={[styles.detailBlock, { color: theme.text }]}>
              {selectedRunDetail?.assistantMessage ||
                selectedRunDetail?.run.resultSummary ||
                latestRun?.resultSummary ||
                'No assistant summary captured.'}
            </Text>
            {selectedRunDetail?.userMessage ? (
              <Text style={[styles.detailMeta, { color: theme.textSecondary }]}>
                Prompt: {selectedRunDetail.userMessage}
              </Text>
            ) : null}
            <Text style={[styles.detailMeta, { color: theme.textSecondary }]}>
              Tools {selectedRunDetail?.tools?.length || 0} · Outputs {selectedRunDetail?.outputs?.length || 0} · Events{' '}
              {selectedRunDetail?.events?.length || 0}
            </Text>
            {selectedRunDetail?.events?.slice(0, 5).map((event) => (
              <View key={event._id} style={[styles.eventRow, { borderBottomColor: theme.border }]}>
                <Text style={[styles.eventStage, { color: theme.text }]}>{event.stage}</Text>
                <Text style={[styles.eventMessage, { color: theme.textSecondary }]}>{event.message}</Text>
              </View>
            ))}
          </PanelCard>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  backText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
  },
  description: {
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  metricGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metricCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 18,
    padding: spacing.md,
    gap: 4,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metricValue: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  caption: {
    fontSize: fontSize.sm,
    lineHeight: 20,
    marginTop: spacing.md,
  },
  primaryButton: {
    minHeight: 44,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  primaryButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  sectionHeader: {
    minHeight: 56,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  rowBody: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  rowMeta: {
    fontSize: fontSize.sm,
    lineHeight: 19,
  },
  rowCaption: {
    fontSize: fontSize.xs,
    lineHeight: 17,
  },
  retryButton: {
    minHeight: 36,
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  detailBlock: {
    fontSize: fontSize.md,
    lineHeight: 22,
    marginTop: spacing.md,
  },
  detailMeta: {
    fontSize: fontSize.sm,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  eventRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    marginTop: spacing.sm,
  },
  eventStage: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  eventMessage: {
    fontSize: fontSize.sm,
    lineHeight: 19,
    marginTop: 4,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl * 2,
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
})
