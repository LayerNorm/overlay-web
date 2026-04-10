import React, { useCallback, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { useTheme } from '../../hooks/useTheme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { PanelCard, SectionLabel } from '../../components/ui/PanelPrimitives'
import { listAutomations, runAutomation } from '../../services/automationsService'
import type { AutomationSummary } from '../../services/appContracts'

function formatTimestamp(timestamp?: number): string {
  if (!timestamp) return 'Not scheduled'
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function AutomationsScreen(): React.ReactElement {
  const { theme } = useTheme()
  const router = useRouter()
  const [automations, setAutomations] = useState<AutomationSummary[]>([])
  const [runningId, setRunningId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const nextAutomations = await listAutomations().catch(() => [])
    setAutomations(nextAutomations)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  const activeCount = useMemo(() => automations.filter((item) => item.status === 'active').length, [automations])

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backRow}>
          <Feather name="chevron-left" size={18} color={theme.textSecondary} />
          <Text style={[styles.backText, { color: theme.textSecondary }]}>Back</Text>
        </TouchableOpacity>

        <SectionLabel theme={theme}>Automations</SectionLabel>
        <Text style={[styles.title, { color: theme.text }]}>Scheduled Workflows</Text>
        <Text style={[styles.description, { color: theme.textSecondary }]}>
          Review automation health, open run history, and trigger work manually from mobile.
        </Text>

        <View style={styles.metricRow}>
          <View style={[styles.metricCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Total</Text>
            <Text style={[styles.metricValue, { color: theme.text }]}>{automations.length}</Text>
          </View>
          <View style={[styles.metricCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>Active</Text>
            <Text style={[styles.metricValue, { color: theme.text }]}>{activeCount}</Text>
          </View>
        </View>

        <PanelCard theme={theme} padded={false}>
          {automations.length > 0 ? (
            automations.map((automation, index) => (
              <TouchableOpacity
                key={automation._id}
                onPress={() => router.push(`/more/automation/${automation._id}`)}
                activeOpacity={0.82}
                style={[
                  styles.row,
                  { borderBottomColor: index === automations.length - 1 ? 'transparent' : theme.border },
                ]}
              >
                <View style={styles.rowBody}>
                  <View style={styles.titleLine}>
                    <Text style={[styles.rowTitle, { color: theme.text }]}>{automation.title}</Text>
                    <View
                      style={[
                        styles.statusPill,
                        {
                          backgroundColor:
                            automation.status === 'active'
                              ? 'rgba(16, 185, 129, 0.12)'
                              : automation.status === 'paused'
                                ? 'rgba(245, 158, 11, 0.12)'
                                : 'rgba(107, 114, 128, 0.12)',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusPillText,
                          {
                            color:
                              automation.status === 'active'
                                ? '#10B981'
                                : automation.status === 'paused'
                                  ? '#F59E0B'
                                  : '#6B7280',
                          },
                        ]}
                      >
                        {automation.status}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.rowMeta, { color: theme.textSecondary }]} numberOfLines={2}>
                    {automation.description || `${automation.scheduleKind} · ${automation.mode}`}
                  </Text>
                  <Text style={[styles.rowCaption, { color: theme.textDisabled }]}>
                    Next run {formatTimestamp(automation.nextRunAt)} · Last {automation.lastRunStatus || 'none'}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    setRunningId(automation._id)
                    void runAutomation(automation._id).finally(() => {
                      setRunningId(null)
                      void refresh()
                    })
                  }}
                  style={[styles.runButton, { backgroundColor: theme.text }]}
                >
                  <Text style={[styles.runButtonText, { color: theme.surface }]}>
                    {runningId === automation._id ? 'Running…' : 'Run'}
                  </Text>
                </TouchableOpacity>
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Feather name="repeat" size={24} color={theme.textSecondary} />
              <Text style={[styles.emptyTitle, { color: theme.text }]}>No automations yet</Text>
              <Text style={[styles.emptyCopy, { color: theme.textSecondary }]}>
                Automations created on web appear here with run status and health details.
              </Text>
            </View>
          )}
        </PanelCard>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  metricRow: {
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
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  rowTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  statusPill: {
    borderRadius: borderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  rowMeta: {
    fontSize: fontSize.sm,
    lineHeight: 19,
  },
  rowCaption: {
    fontSize: fontSize.xs,
  },
  runButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
  },
  runButtonText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
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
  emptyCopy: {
    fontSize: fontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
})
