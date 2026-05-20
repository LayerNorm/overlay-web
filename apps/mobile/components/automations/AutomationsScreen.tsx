import React, { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import type { AutomationSchedule, AutomationSummary } from '@overlay/app-core'
import { useTheme } from '../../hooks/useTheme'
import { useDrawer } from '../../contexts/DrawerContext'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { DrawerSidebar } from '../chat/DrawerSidebar'
import { BottomSheet, EmptyState, MainScreenHeader, StatusPill, TopBarIconButton } from '../ui/AppChrome'
import { ScreenWithDrawer } from '../ui/ScreenWithDrawer'
import {
  createAutomation,
  deleteAutomation,
  listAutomationRuns,
  listAutomations,
  setAutomationEnabled,
  updateAutomation,
} from '../../services/automationsService'

function formatSchedule(schedule?: AutomationSchedule): string {
  if (!schedule) return 'Unscheduled'
  if (schedule.kind === 'interval') return `Every ${schedule.intervalMinutes ?? 60} min`
  if (schedule.kind === 'daily') return `Daily at ${String(schedule.hourUTC ?? 9).padStart(2, '0')}:${String(schedule.minuteUTC ?? 0).padStart(2, '0')} UTC`
  if (schedule.kind === 'weekly') return `Weekly, day ${schedule.dayOfWeekUTC ?? 1}`
  return `Monthly, day ${schedule.dayOfMonthUTC ?? 1}`
}

export function AutomationsScreen(): React.ReactElement {
  const { theme, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const { openDrawer } = useDrawer()
  const [automations, setAutomations] = useState<AutomationSummary[]>([])
  const [selected, setSelected] = useState<AutomationSummary | null>(null)
  const [runs, setRuns] = useState<Array<{ _id: string; status: string; scheduledFor: number; errorMessage?: string; resultSummary?: string }>>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [intervalMinutes, setIntervalMinutes] = useState('60')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setAutomations(await listAutomations())
    } catch (error) {
      Alert.alert('Automations unavailable', error instanceof Error ? error.message : 'Could not load automations')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  const sorted = useMemo(
    () => [...automations].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    [automations],
  )

  function openCreate(): void {
    setSelected(null)
    setName('')
    setDescription('')
    setInstructions('')
    setIntervalMinutes('60')
    setRuns([])
    setEditorOpen(true)
  }

  async function openEdit(item: AutomationSummary): Promise<void> {
    setSelected(item)
    setName(item.name || item.title || '')
    setDescription(item.description || '')
    setInstructions(item.instructions || item.instructionsMarkdown || '')
    setIntervalMinutes(String(item.schedule?.kind === 'interval' ? item.schedule.intervalMinutes ?? 60 : 60))
    setEditorOpen(true)
    try {
      setRuns(await listAutomationRuns(item._id))
    } catch {
      setRuns([])
    }
  }

  async function save(): Promise<void> {
    const cleanName = name.trim()
    const cleanDescription = description.trim()
    const cleanInstructions = instructions.trim()
    const minutes = Math.max(15, Number.parseInt(intervalMinutes, 10) || 60)
    if (!cleanName || !cleanDescription || !cleanInstructions) {
      Alert.alert('Missing fields', 'Name, description, and instructions are required.')
      return
    }
    setSaving(true)
    try {
      if (selected) {
        await updateAutomation(selected._id, {
          name: cleanName,
          description: cleanDescription,
          instructions: cleanInstructions,
          schedule: { kind: 'interval', intervalMinutes: minutes },
        })
      } else {
        await createAutomation({
          name: cleanName,
          description: cleanDescription,
          instructions: cleanInstructions,
          enabled: false,
          schedule: { kind: 'interval', intervalMinutes: minutes },
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
      }
      setEditorOpen(false)
      await load()
    } catch (error) {
      Alert.alert('Could not save automation', error instanceof Error ? error.message : 'Try again.')
    } finally {
      setSaving(false)
    }
  }

  async function toggle(item: AutomationSummary, enabled: boolean): Promise<void> {
    setAutomations((prev) => prev.map((row) => row._id === item._id ? { ...row, enabled } : row))
    try {
      await setAutomationEnabled(item._id, enabled)
    } catch (error) {
      setAutomations((prev) => prev.map((row) => row._id === item._id ? { ...row, enabled: item.enabled } : row))
      Alert.alert('Could not update automation', error instanceof Error ? error.message : 'Try again.')
    }
  }

  function confirmDelete(item: AutomationSummary): void {
    Alert.alert('Delete automation', `Delete ${item.name || item.title || 'this automation'}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAutomation(item._id)
            setAutomations((prev) => prev.filter((row) => row._id !== item._id))
          } catch (error) {
            Alert.alert('Could not delete automation', error instanceof Error ? error.message : 'Try again.')
          }
        },
      },
    ])
  }

  return (
    <ScreenWithDrawer drawer={<DrawerSidebar variant="slide" theme={theme} chats={[]} activeChatId={null} onSelectChat={() => {}} onCreateChat={() => {}} />}>
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['bottom']}>
        <MainScreenHeader
          theme={theme}
          isDark={isDark}
          topInset={insets.top}
          blurHeight={insets.top + 56}
          leftSlot={<TopBarIconButton theme={theme} icon="menu" onPress={openDrawer} />}
          centerSlot={<Text style={[styles.headerTitle, { color: theme.text }]}>Automations</Text>}
          rightSlot={<TopBarIconButton theme={theme} icon="plus" onPress={openCreate} />}
        />
        <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 72 }]}>
          {loading ? (
            <ActivityIndicator color={theme.textSecondary} />
          ) : sorted.length === 0 ? (
            <EmptyState theme={theme} icon="zap" title="No automations" description="Create scheduled workflows that run through the Overlay backend." />
          ) : sorted.map((item) => (
            <TouchableOpacity
              key={item._id}
              activeOpacity={0.82}
              onPress={() => { void openEdit(item) }}
              style={[styles.card, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}
            >
              <View style={styles.cardTop}>
                <View style={styles.cardCopy}>
                  <Text style={[styles.cardTitle, { color: theme.text }]}>{item.name || item.title || 'Untitled automation'}</Text>
                  <Text style={[styles.cardMeta, { color: theme.textSecondary }]}>{formatSchedule(item.schedule)}</Text>
                </View>
                <Switch value={item.enabled !== false} onValueChange={(next) => { void toggle(item, next) }} />
              </View>
              {item.description ? <Text style={[styles.cardDescription, { color: theme.textSecondary }]} numberOfLines={2}>{item.description}</Text> : null}
              <View style={styles.cardFooter}>
                <StatusPill theme={theme} label={item.lastRunStatus || (item.enabled === false ? 'Paused' : 'Active')} tone={item.enabled === false ? 'default' : 'active'} />
                <TouchableOpacity onPress={() => confirmDelete(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Feather name="trash-2" size={16} color="#EF4444" />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <BottomSheet theme={theme} visible={editorOpen} onClose={() => setEditorOpen(false)} title={selected ? 'Edit Automation' : 'New Automation'}>
          <View style={styles.form}>
            <TextInput value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={theme.textDisabled} style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]} />
            <TextInput value={description} onChangeText={setDescription} placeholder="Description" placeholderTextColor={theme.textDisabled} style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]} />
            <TextInput value={instructions} onChangeText={setInstructions} placeholder="Instructions" placeholderTextColor={theme.textDisabled} multiline style={[styles.textArea, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]} />
            <TextInput value={intervalMinutes} onChangeText={setIntervalMinutes} keyboardType="number-pad" placeholder="Interval minutes" placeholderTextColor={theme.textDisabled} style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]} />
            {runs.length > 0 ? (
              <View style={styles.runs}>
                <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Recent runs</Text>
                {runs.slice(0, 5).map((run) => (
                  <Text key={run._id} style={[styles.runText, { color: theme.textSecondary }]}>{run.status} · {new Date(run.scheduledFor).toLocaleString()}</Text>
                ))}
              </View>
            ) : null}
            <TouchableOpacity onPress={() => { void save() }} disabled={saving} style={[styles.primaryButton, { backgroundColor: theme.foreground, opacity: saving ? 0.6 : 1 }]}>
              {saving ? <ActivityIndicator color={theme.background} /> : <Text style={[styles.primaryButtonText, { color: theme.background }]}>Save</Text>}
            </TouchableOpacity>
          </View>
        </BottomSheet>
      </SafeAreaView>
    </ScreenWithDrawer>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerTitle: { fontSize: fontSize.md, fontWeight: '700', textAlign: 'center' },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.xl, padding: spacing.md, gap: spacing.md },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  cardCopy: { flex: 1, gap: 4 },
  cardTitle: { fontSize: fontSize.md, fontWeight: '700' },
  cardMeta: { fontSize: fontSize.sm },
  cardDescription: { fontSize: fontSize.sm, lineHeight: 20 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  form: { gap: spacing.md },
  input: { minHeight: 46, borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.lg, paddingHorizontal: spacing.md, fontSize: fontSize.md },
  textArea: { minHeight: 140, borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.lg, padding: spacing.md, fontSize: fontSize.md, textAlignVertical: 'top' },
  runs: { gap: 6 },
  sectionLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 },
  runText: { fontSize: fontSize.sm },
  primaryButton: { minHeight: 46, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { fontSize: fontSize.md, fontWeight: '700' },
})
