import React from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import type { AutomationScheduleDraft, DraftModalState } from '@overlay/chat-core'
import { useTheme } from '../../hooks/useTheme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { BottomSheet } from '../ui/AppChrome'

function formatDraftSchedule(schedule: AutomationScheduleDraft | undefined): string {
  if (!schedule) return 'Unscheduled'
  if (schedule.kind === 'interval') return `Every ${schedule.intervalMinutes} minutes`
  if (schedule.kind === 'daily') {
    return `Daily at ${String(schedule.hourUTC).padStart(2, '0')}:${String(schedule.minuteUTC).padStart(2, '0')} UTC`
  }
  if (schedule.kind === 'weekly') {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    return `${days[schedule.dayOfWeekUTC] ?? 'Weekly'} at ${String(schedule.hourUTC).padStart(2, '0')}:${String(schedule.minuteUTC).padStart(2, '0')} UTC`
  }
  return `Monthly on day ${schedule.dayOfMonthUTC} at ${String(schedule.hourUTC).padStart(2, '0')}:${String(schedule.minuteUTC).padStart(2, '0')} UTC`
}

function confidenceLabel(value: 'low' | 'medium' | 'high'): string {
  return value === 'high' ? 'High confidence' : value === 'medium' ? 'Medium confidence' : 'Low confidence'
}

export function DraftReviewSheet({
  state,
  saving,
  saveError,
  onClose,
  onSave,
}: {
  state: DraftModalState | null
  saving: boolean
  saveError?: string
  onClose: () => void
  /** Skill → skills.create; automation → send "Create automation" (web parity —
   *  the chat agent owns automation creation so it can ask follow-ups). */
  onSave: (state: DraftModalState) => void
}): React.ReactElement {
  const { theme } = useTheme()
  const draft = state?.draft
  const isAutomation = state?.kind === 'automation'

  return (
    <BottomSheet
      theme={theme}
      visible={state !== null}
      onClose={onClose}
      title={isAutomation ? 'Automation draft' : 'Skill draft'}
    >
      {!draft ? (
        <View />
      ) : (
        <View style={styles.body}>
          <ScrollView style={styles.scroll} nestedScrollEnabled>
            <Text style={[styles.name, { color: theme.text }]}>{draft.name}</Text>
            {draft.description ? (
              <Text style={[styles.description, { color: theme.textSecondary }]}>{draft.description}</Text>
            ) : null}

            {isAutomation && 'schedule' in draft ? (
              <View style={[styles.metaCard, { borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}>
                <MetaRow theme={theme} label="Schedule" value={formatDraftSchedule(draft.schedule)} />
                <MetaRow theme={theme} label="Time zone" value={draft.timezone || 'UTC'} />
              </View>
            ) : null}

            <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Instructions</Text>
            <View style={[styles.instructionsBox, { borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}>
              <Text style={[styles.instructions, { color: theme.text }]}>{draft.instructions}</Text>
            </View>

            {draft.detectedIntegrations?.length ? (
              <>
                <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Integrations</Text>
                <View style={styles.chips}>
                  {draft.detectedIntegrations.map((integration) => (
                    <View key={integration} style={[styles.chip, { borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}>
                      <Text style={[styles.chipText, { color: theme.text }]}>{integration}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            {isAutomation && 'missingFields' in draft && draft.missingFields.length > 0 ? (
              <View style={[styles.missingBox, { borderColor: '#EF4444' }]}>
                <Text style={styles.missingTitle}>Missing details</Text>
                {draft.missingFields.map((field) => (
                  <Text key={field} style={styles.missingItem}>· {field}</Text>
                ))}
              </View>
            ) : null}

            <Text style={[styles.reason, { color: theme.textSecondary }]}>
              {confidenceLabel(draft.confidence)} · {draft.reason}
            </Text>
            {saveError ? <Text accessibilityRole="alert" style={styles.saveError}>{saveError}</Text> : null}
          </ScrollView>

          <TouchableOpacity
            onPress={() => onSave(state!)}
            disabled={saving}
            style={[styles.primaryButton, { backgroundColor: theme.foreground, opacity: saving ? 0.6 : 1 }]}
          >
            {saving ? (
              <ActivityIndicator color={theme.background} />
            ) : (
              <Text style={[styles.primaryButtonText, { color: theme.background }]}>
                {isAutomation ? 'Create automation' : 'Save skill'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </BottomSheet>
  )
}

function MetaRow({ theme, label, value }: { theme: ReturnType<typeof useTheme>['theme']; label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={[styles.metaLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.metaValue, { color: theme.text }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  scroll: { maxHeight: 420 },
  name: { fontSize: fontSize.lg, fontWeight: '700' },
  description: { fontSize: fontSize.sm, lineHeight: 20, marginTop: 4 },
  metaCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.lg, padding: spacing.md, gap: spacing.sm, marginTop: spacing.sm },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  metaLabel: { fontSize: fontSize.sm },
  metaValue: { fontSize: fontSize.sm, fontWeight: '600' },
  sectionLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7, marginTop: spacing.sm },
  instructionsBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.lg, padding: spacing.md },
  instructions: { fontSize: fontSize.sm, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.full, paddingHorizontal: spacing.md, paddingVertical: 5 },
  chipText: { fontSize: fontSize.sm, fontWeight: '600' },
  missingBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.lg, padding: spacing.md, gap: 4, marginTop: spacing.xs },
  missingTitle: { color: '#EF4444', fontSize: fontSize.sm, fontWeight: '700' },
  missingItem: { color: '#EF4444', fontSize: fontSize.sm },
  reason: { fontSize: 11, lineHeight: 16, marginTop: spacing.sm },
  saveError: { color: '#EF4444', fontSize: fontSize.sm },
  primaryButton: { minHeight: 46, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { fontSize: fontSize.md, fontWeight: '700' },
})
