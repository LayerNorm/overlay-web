import React, { useState } from 'react'
import { Pressable, View } from 'react-native'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react-native'
import type { WorkItem } from '@overlay/app-core'
import {
  addDays,
  formatWorkDate,
  formatWorkDateRange,
  startOfWeek,
} from '../../../src/shared/work/dates'
import { barLayout, buildTimelineRows } from '../../../src/shared/work/timeline'
import { WORK_STATUS_LABELS } from '../../lib/work'
import type { Theme } from '../../constants/theme'
import { Button, IconButton, T } from '../shell/primitives'

const dayCount = 7
const actionWidth = 34
const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export function WorkTimeline({
  items,
  today,
  theme,
  onOpen,
  canEdit,
  onSchedule,
}: {
  items: WorkItem[]
  today: string
  theme: Theme
  onOpen: (id: string) => void
  canEdit: (item: WorkItem) => boolean
  onSchedule: (item: WorkItem) => void
}) {
  const [selectedWeek, setSelectedWeek] = useState<string>()
  const start = selectedWeek ?? startOfWeek(today)
  const end = addDays(start, dayCount - 1)
  const range = { start, days: dayCount }
  const allRows = buildTimelineRows(items)
  const rows = allRows.filter(({ span }) => span && span.start <= end && span.end >= start)
  const unscheduled = allRows.filter(({ item }) => !item.startDate && !item.dueDate)
  return (
    <View style={{ marginHorizontal: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginVertical: 8 }}>
        <IconButton
          label="Previous week"
          icon={ChevronLeft}
          theme={theme}
          onPress={() => setSelectedWeek(addDays(start, -dayCount))}
        />
        <T style={{ flex: 1, textAlign: 'center', color: theme.foreground }}>
          {formatWorkDateRange(start, end, today)}
        </T>
        <IconButton
          label="Next week"
          icon={ChevronRight}
          theme={theme}
          onPress={() => setSelectedWeek(addDays(start, dayCount))}
        />
        <Button
          theme={theme}
          disabled={start === startOfWeek(today)}
          onPress={() => setSelectedWeek(undefined)}
        >
          Today
        </Button>
      </View>
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: theme.border }}>
        <View style={{ flex: 3.8 }} />
        {days.map((letter, index) => {
          const date = addDays(start, index)
          const isToday = date === today
          return (
            <T
              key={date}
              accessibilityLabel={formatWorkDate(date, today)}
              style={{
                flex: 6.2 / dayCount,
                textAlign: 'center',
                paddingVertical: 8,
                color: isToday ? theme.foreground : theme.muted,
                fontWeight: isToday ? '600' : '400',
                fontSize: 11,
              }}
            >
              {letter}
            </T>
          )
        })}
        <View style={{ width: actionWidth }} />
      </View>
      {rows.map(({ item, span, kind }) => {
        if (!span) return null
        const { left, width } = barLayout(span, range, 100 / dayCount)
        return (
          <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, ${WORK_STATUS_LABELS[item.status]}, ${formatWorkDateRange(span.start, span.end, today)}`}
              onPress={() => onOpen(item.id)}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                minHeight: 44,
                borderBottomWidth: 1,
                borderColor: theme.border,
                backgroundColor: pressed ? theme.surfaceSubtle : 'transparent',
              })}
            >
              <T
                numberOfLines={2}
                style={{
                  width: '38%',
                  paddingRight: 8,
                  color: theme.foreground,
                  fontWeight: kind === 'objective' ? '600' : '400',
                  fontSize: 12,
                }}
              >
                {item.title}
              </T>
              <View style={{ flex: 1, height: 16, justifyContent: 'center' }}>
                <View
                  style={{
                    position: 'absolute',
                    left: `${left}%`,
                    width: `${width}%`,
                    height: kind === 'objective' ? 6 : 12,
                    borderRadius: 3,
                    backgroundColor: kind === 'objective' ? theme.muted : theme.surfaceSubtle,
                    borderWidth: 1,
                    borderColor: theme.border,
                  }}
                />
              </View>
            </Pressable>
            <View style={{ width: actionWidth }}>
              {canEdit(item) ? (
                <IconButton
                  icon={CalendarDays}
                  label={`Schedule ${item.title}`}
                  theme={theme}
                  onPress={() => onSchedule(item)}
                />
              ) : null}
            </View>
          </View>
        )
      })}
      {rows.length === 0 ? (
        <T style={{ textAlign: 'center', color: theme.muted, padding: 40 }}>
          No scheduled tasks this week.
        </T>
      ) : null}
      {unscheduled.length ? (
        <View>
          <T style={{ color: theme.muted, paddingVertical: 12 }}>Unscheduled</T>
          {unscheduled.map(({ item }) => (
            <View
              key={item.id}
              style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}
            >
              <Pressable
                accessibilityRole="button"
                style={{ flex: 1 }}
                onPress={() => onOpen(item.id)}
              >
                <T style={{ color: theme.foreground }}>{item.title}</T>
              </Pressable>
              {canEdit(item) ? (
                <IconButton
                  icon={CalendarDays}
                  label={`Schedule ${item.title}`}
                  theme={theme}
                  onPress={() => onSchedule(item)}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}
