import React, { useMemo, useState } from 'react'
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
import { Feather } from '@expo/vector-icons'
import {
  buildAutomationSchedule,
  localFieldsFromSchedule,
  safeTimeZone,
  supportedTimeZoneOptions,
  type AutomationSummary,
  type AutomationSchedule,
} from '@overlay/app-core'
import { useTheme } from '../../hooks/useTheme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { BottomSheet, SearchField, SegmentedControl } from '../ui/AppChrome'
import { createAutomation, updateAutomation } from '../../services/automationsService'

type ScheduleKind = AutomationSchedule['kind']

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const

export function AutomationEditorSheet({
  visible,
  automation,
  onClose,
  onSaved,
}: {
  visible: boolean
  automation: AutomationSummary | null
  onClose: () => void
  onSaved: () => void
}): React.ReactElement {
  const { theme } = useTheme()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>('interval')
  const [intervalMinutes, setIntervalMinutes] = useState('60')
  const [time, setTime] = useState('09:00')
  const [dayOfWeek, setDayOfWeek] = useState(1)
  const [dayOfMonth, setDayOfMonth] = useState('1')
  const [timezone, setTimezone] = useState('')
  const [tzPickerOpen, setTzPickerOpen] = useState(false)
  const [tzQuery, setTzQuery] = useState('')

  // Seed the form each time the sheet opens for a different automation (or a
  // fresh create). `visible` flips reset through the parent.
  React.useEffect(() => {
    if (!visible) return
    const tz = safeTimeZone(automation?.timezone)
    const local = localFieldsFromSchedule(automation?.schedule, tz)
    setName(automation?.name || automation?.title || '')
    setDescription(automation?.description || '')
    setInstructions(automation?.instructions || automation?.instructionsMarkdown || '')
    setEnabled(automation?.enabled !== false)
    setScheduleKind(automation?.schedule?.kind ?? 'interval')
    setIntervalMinutes(
      String(automation?.schedule?.kind === 'interval' ? automation.schedule.intervalMinutes ?? 60 : 60),
    )
    setTime(local.time)
    setDayOfWeek(local.dayOfWeek)
    setDayOfMonth(String(local.dayOfMonth))
    setTimezone(tz)
    setTzPickerOpen(false)
    setTzQuery('')
  }, [visible, automation])

  const tzOptions = useMemo(() => supportedTimeZoneOptions(), [])
  const filteredZones = useMemo(() => {
    const q = tzQuery.trim().toLowerCase()
    if (!q) return tzOptions
    return tzOptions.filter((zone) => zone.label.toLowerCase().includes(q) || zone.value.toLowerCase().includes(q))
  }, [tzOptions, tzQuery])
  const timezoneLabel = useMemo(
    () => tzOptions.find((zone) => zone.value === timezone)?.label ?? timezone,
    [tzOptions, timezone],
  )

  async function save(): Promise<void> {
    const cleanName = name.trim()
    const cleanDescription = description.trim()
    const cleanInstructions = instructions.trim()
    if (!cleanName || !cleanDescription || !cleanInstructions) {
      Alert.alert('Missing fields', 'Name, description, and instructions are required.')
      return
    }
    const schedule = buildAutomationSchedule({
      kind: scheduleKind,
      intervalMinutes: Number.parseInt(intervalMinutes, 10) || 60,
      time,
      dayOfWeek,
      dayOfMonth: Number.parseInt(dayOfMonth, 10) || 1,
      timeZone: timezone,
    })
    setSaving(true)
    try {
      if (automation) {
        await updateAutomation(automation._id, {
          name: cleanName,
          description: cleanDescription,
          instructions: cleanInstructions,
          enabled,
          schedule,
          timezone,
        })
      } else {
        await createAutomation({
          name: cleanName,
          description: cleanDescription,
          instructions: cleanInstructions,
          enabled,
          schedule,
          timezone,
        })
      }
      onSaved()
    } catch (error) {
      Alert.alert('Could not save automation', error instanceof Error ? error.message : 'Try again.')
    } finally {
      setSaving(false)
    }
  }

  const tzPicker = (
    <View style={styles.tzPicker}>
      <SearchField theme={theme} value={tzQuery} onChangeText={setTzQuery} placeholder="Search time zones" />
      <ScrollView style={styles.tzList} keyboardShouldPersistTaps="handled">
        {filteredZones.slice(0, 80).map((zone) => (
          <TouchableOpacity
            key={zone.value}
            onPress={() => {
              setTimezone(zone.value)
              setTzPickerOpen(false)
            }}
            style={[styles.tzRow, { borderBottomColor: theme.border }]}
          >
            <Text style={[styles.tzRowText, { color: theme.text }]}>{zone.label}</Text>
            {zone.value === timezone ? <Feather name="check" size={15} color={theme.text} /> : null}
          </TouchableOpacity>
        ))}
        {filteredZones.length === 0 ? (
          <Text style={[styles.tzEmpty, { color: theme.textSecondary }]}>No time zones match.</Text>
        ) : null}
      </ScrollView>
      <TouchableOpacity onPress={() => setTzPickerOpen(false)} style={styles.tzBack}>
        <Text style={[styles.tzBackText, { color: theme.text }]}>Back to automation</Text>
      </TouchableOpacity>
    </View>
  )

  const form = (
    <View style={styles.form}>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Name"
        placeholderTextColor={theme.textDisabled}
        style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}
      />
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="Description"
        placeholderTextColor={theme.textDisabled}
        style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}
      />
      <TextInput
        value={instructions}
        onChangeText={setInstructions}
        placeholder="Instructions — what should this automation do?"
        placeholderTextColor={theme.textDisabled}
        multiline
        style={[styles.textArea, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}
      />

      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Schedule</Text>
      <SegmentedControl
        theme={theme}
        value={scheduleKind}
        onChange={setScheduleKind}
        options={[
          { label: 'Interval', value: 'interval' },
          { label: 'Daily', value: 'daily' },
          { label: 'Weekly', value: 'weekly' },
          { label: 'Monthly', value: 'monthly' },
        ]}
      />
      {scheduleKind === 'interval' ? (
        <View style={styles.fieldRow}>
          <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Every (minutes)</Text>
          <TextInput
            value={intervalMinutes}
            onChangeText={setIntervalMinutes}
            keyboardType="number-pad"
            placeholder="60"
            placeholderTextColor={theme.textDisabled}
            style={[styles.inlineInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}
          />
        </View>
      ) : (
        <>
          {scheduleKind === 'weekly' ? (
            <View style={styles.weekdayRow}>
              {WEEKDAY_LETTERS.map((letter, index) => (
                <TouchableOpacity
                  key={`${letter}-${index}`}
                  onPress={() => setDayOfWeek(index)}
                  style={[
                    styles.weekdayChip,
                    {
                      backgroundColor: dayOfWeek === index ? theme.foreground : theme.surfaceElevated,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <Text style={[styles.weekdayChipText, { color: dayOfWeek === index ? theme.background : theme.text }]}>
                    {letter}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {scheduleKind === 'monthly' ? (
            <View style={styles.fieldRow}>
              <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Day of month</Text>
              <TextInput
                value={dayOfMonth}
                onChangeText={setDayOfMonth}
                keyboardType="number-pad"
                placeholder="1"
                placeholderTextColor={theme.textDisabled}
                style={[styles.inlineInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}
              />
            </View>
          ) : null}
          <View style={styles.fieldRow}>
            <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Time (24h)</Text>
            <TextInput
              value={time}
              onChangeText={setTime}
              placeholder="09:00"
              placeholderTextColor={theme.textDisabled}
              autoCapitalize="none"
              style={[styles.inlineInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}
            />
          </View>
        </>
      )}
      <TouchableOpacity
        onPress={() => setTzPickerOpen(true)}
        style={[styles.tzButton, { borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}
      >
        <Feather name="globe" size={15} color={theme.textSecondary} />
        <Text style={[styles.tzButtonText, { color: theme.text }]} numberOfLines={1}>{timezoneLabel}</Text>
        <Feather name="chevron-right" size={15} color={theme.textSecondary} />
      </TouchableOpacity>

      <View style={styles.fieldRow}>
        <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Enabled</Text>
        <Switch value={enabled} onValueChange={setEnabled} />
      </View>

      <TouchableOpacity
        onPress={() => { void save() }}
        disabled={saving}
        style={[styles.primaryButton, { backgroundColor: theme.foreground, opacity: saving ? 0.6 : 1 }]}
      >
        {saving ? <ActivityIndicator color={theme.background} /> : <Text style={[styles.primaryButtonText, { color: theme.background }]}>Save</Text>}
      </TouchableOpacity>
    </View>
  )

  return (
    <BottomSheet
      theme={theme}
      visible={visible}
      onClose={onClose}
      title={tzPickerOpen ? 'Time zone' : automation ? 'Edit Automation' : 'New Automation'}
    >
      {tzPickerOpen ? tzPicker : form}
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  input: { minHeight: 46, borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.lg, paddingHorizontal: spacing.md, fontSize: fontSize.md },
  textArea: { minHeight: 140, borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.lg, padding: spacing.md, fontSize: fontSize.md, textAlignVertical: 'top' },
  sectionLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  fieldLabel: { fontSize: fontSize.sm, fontWeight: '600' },
  inlineInput: { minWidth: 110, minHeight: 40, borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.lg, paddingHorizontal: spacing.md, fontSize: fontSize.md, textAlign: 'center' },
  weekdayRow: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  weekdayChip: { width: 38, height: 38, borderRadius: borderRadius.full, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  weekdayChipText: { fontSize: fontSize.sm, fontWeight: '700' },
  tzButton: { minHeight: 46, borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.lg, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tzButtonText: { flex: 1, fontSize: fontSize.sm, fontWeight: '600' },
  tzPicker: { gap: spacing.md },
  tzList: { maxHeight: 320 },
  tzRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, paddingRight: spacing.xs },
  tzRowText: { fontSize: fontSize.sm },
  tzEmpty: { fontSize: fontSize.sm, paddingVertical: spacing.lg, textAlign: 'center' },
  tzBack: { alignItems: 'center', paddingVertical: spacing.xs },
  tzBackText: { fontSize: fontSize.sm, fontWeight: '700' },
  primaryButton: { minHeight: 46, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { fontSize: fontSize.md, fontWeight: '700' },
})
