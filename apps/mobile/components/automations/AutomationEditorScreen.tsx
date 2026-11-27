import React, { useMemo, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { DatePicker, Form, Host, Picker, Section, Text, TextField, Toggle } from '@expo/ui/swift-ui'
import { datePickerStyle, lineLimit, pickerStyle, tag, tint } from '@expo/ui/swift-ui/modifiers'
import {
  buildAutomationSchedule,
  localFieldsFromSchedule,
  safeTimeZone,
  supportedTimeZoneOptions,
  type AutomationSchedule,
  type AutomationSummary,
} from '@overlay/app-core'
import { useTheme } from '../../hooks/useTheme'
import { useLiveResource } from '../../hooks/useLiveResource'
import { useNativeDataReady } from '../../contexts/ConvexAuthProvider'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useSwitchTint } from '../../lib/nativeControls'
import { api, type Id } from '../../services/convexClient'
import { getRequestWorkspaceId } from '../../services/appApi'
import { createAutomation, updateAutomation } from '../../services/automationsService'

type ScheduleKind = AutomationSchedule['kind']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const INTERVALS = [15, 30, 60, 120, 240, 360, 720]

function intervalLabel(minutes: number) {
  return minutes < 60 ? `${minutes} minutes` : minutes === 60 ? 'Hour' : `${minutes / 60} hours`
}
function timeToDate(time: string) {
  const [hour, minute] = time.split(':').map(Number)
  const date = new Date()
  date.setHours(hour || 0, minute || 0, 0, 0)
  return date
}
function dateToTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** `/automation-edit?id=…` — create or edit an automation in a native form sheet. */
export function AutomationEditorScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  const ready = useNativeDataReady()
  const { activeWorkspaceId } = useWorkspace()
  const scope = ready ? activeWorkspaceId : null
  const detail = useLiveResource(
    api.automations.browse.get,
    scope && id ? { workspaceId: scope, automationId: id as Id<'automations'> } : null,
  )
  const { theme } = useTheme()
  if (id && !detail.data) {
    return (
      <>
        <Stack.Screen options={{ title: 'Edit automation' }} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.muted as string} />
        </View>
      </>
    )
  }
  return <AutomationForm key={detail.data?._id ?? 'new'} workspaceId={scope} automation={(detail.data as AutomationSummary | undefined) ?? null} />
}

function AutomationForm({ workspaceId, automation }: { workspaceId: string | null; automation: AutomationSummary | null }) {
  const router = useRouter()
  const { theme, isDark } = useTheme()
  const switchTint = useSwitchTint()
  const initialZone = safeTimeZone(automation?.timezone)
  const local = localFieldsFromSchedule(automation?.schedule, initialZone)
  const [name, setName] = useState(automation?.name || automation?.title || '')
  const [description, setDescription] = useState(automation?.description || '')
  const [instructions, setInstructions] = useState(automation?.instructions || automation?.instructionsMarkdown || '')
  const [enabled, setEnabled] = useState(automation?.enabled !== false)
  const [kind, setKind] = useState<ScheduleKind>(automation?.schedule?.kind ?? 'daily')
  const initialInterval = automation?.schedule?.kind === 'interval' ? automation.schedule.intervalMinutes ?? 60 : 60
  const [intervalMinutes, setIntervalMinutes] = useState(initialInterval)
  const [time, setTime] = useState(automation ? local.time : '09:00')
  const [dayOfWeek, setDayOfWeek] = useState(local.dayOfWeek)
  const [dayOfMonth, setDayOfMonth] = useState(local.dayOfMonth)
  const [timezone, setTimezone] = useState(initialZone)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const zones = useMemo(() => supportedTimeZoneOptions(), [])
  const intervals = INTERVALS.includes(intervalMinutes) ? INTERVALS : [...INTERVALS, intervalMinutes].sort((a, b) => a - b)
  const complete = Boolean(name.trim() && description.trim() && instructions.trim())

  async function save() {
    if (saving || !complete || !workspaceId) return
    setSaving(true)
    setError(null)
    const input = {
      name: name.trim(),
      description: description.trim(),
      instructions: instructions.trim(),
      enabled,
      schedule: buildAutomationSchedule({ kind, intervalMinutes, time, dayOfWeek, dayOfMonth, timeZone: timezone }),
      timezone,
    }
    try {
      if (automation) await updateAutomation(automation._id, input)
      else await createAutomation(input)
      if (getRequestWorkspaceId() === workspaceId) router.back()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the automation.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: automation ? 'Edit automation' : 'New automation' }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Cancel" onPress={() => router.back()} />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon="checkmark"
          variant="prominent"
          tintColor={theme.foreground as string}
          accessibilityLabel="Save automation"
          disabled={saving || !complete}
          onPress={() => void save()}
        />
      </Stack.Toolbar>
      <Host style={{ flex: 1 }} colorScheme={isDark ? 'dark' : 'light'}>
        <Form modifiers={[tint(theme.foreground as string)]}>
          <Section footer={error ? <Text>{error}</Text> : <Text>Name, description and instructions are required.</Text>}>
            <TextField placeholder="Name" defaultValue={name} onValueChange={setName} />
            <TextField placeholder="Description" defaultValue={description} onValueChange={setDescription} />
            <TextField
              placeholder="What should this automation do?"
              defaultValue={instructions}
              axis="vertical"
              onValueChange={setInstructions}
              modifiers={[lineLimit({ min: 4, max: 12 })]}
            />
          </Section>
          <Section title="Schedule">
            <Picker selection={kind} onSelectionChange={(value: ScheduleKind) => setKind(value)} modifiers={[pickerStyle('segmented')]}>
              <Text modifiers={[tag('interval')]}>Interval</Text>
              <Text modifiers={[tag('daily')]}>Daily</Text>
              <Text modifiers={[tag('weekly')]}>Weekly</Text>
              <Text modifiers={[tag('monthly')]}>Monthly</Text>
            </Picker>
            {kind === 'interval' ? (
              <Picker label="Every" selection={intervalMinutes} onSelectionChange={(value: number) => setIntervalMinutes(value)} modifiers={[pickerStyle('menu')]}>
                {intervals.map((minutes) => (
                  <Text key={minutes} modifiers={[tag(minutes)]}>{intervalLabel(minutes)}</Text>
                ))}
              </Picker>
            ) : (
              <>
                {kind === 'weekly' ? (
                  <Picker label="Day" selection={dayOfWeek} onSelectionChange={(value: number) => setDayOfWeek(value)} modifiers={[pickerStyle('menu')]}>
                    {WEEKDAYS.map((day, index) => (
                      <Text key={day} modifiers={[tag(index)]}>{day}</Text>
                    ))}
                  </Picker>
                ) : null}
                {kind === 'monthly' ? (
                  <Picker label="Day of month" selection={dayOfMonth} onSelectionChange={(value: number) => setDayOfMonth(value)} modifiers={[pickerStyle('menu')]}>
                    {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                      <Text key={day} modifiers={[tag(day)]}>{String(day)}</Text>
                    ))}
                  </Picker>
                ) : null}
                <DatePicker
                  title="Time"
                  selection={timeToDate(time)}
                  displayedComponents={['hourAndMinute']}
                  onDateChange={(date) => setTime(dateToTime(date))}
                  modifiers={[datePickerStyle('compact')]}
                />
              </>
            )}
            <Picker label="Time zone" selection={timezone} onSelectionChange={(value: string) => setTimezone(value)} modifiers={[pickerStyle('menu')]}>
              {zones.map((zone) => (
                <Text key={zone.value} modifiers={[tag(zone.value)]}>{zone.label}</Text>
              ))}
            </Picker>
          </Section>
          <Section>
            <Toggle label="Enabled" isOn={enabled} onIsOnChange={setEnabled} modifiers={switchTint} />
          </Section>
        </Form>
      </Host>
    </>
  )
}

