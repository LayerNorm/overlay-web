import React, { useState } from 'react'
import type { MoveWorkItemRequest, WorkItem, WorkStatus } from '@overlay/app-core'
import { validateWorkDates } from '../../../src/shared/work/status'
import { sortByRank } from '../../../src/shared/work/query'
import { WORK_STATUSES, WORK_STATUS_LABELS } from '../../lib/work'
import type { Theme } from '../../constants/theme'
import { Button, T } from '../shell/primitives'
import { WorkField, WorkOptions, WorkSheet } from './WorkControls'

export function WorkPlacementSheet({
  item,
  items,
  theme,
  busy,
  error,
  onClose,
  onMove,
}: {
  item: WorkItem
  items: readonly WorkItem[]
  theme: Theme
  busy: boolean
  error: string | null
  onClose: () => void
  onMove: (move: MoveWorkItemRequest) => void
}) {
  const [status, setStatus] = useState<WorkStatus | null>(null)
  if (!status) {
    return (
      <WorkOptions
        title="Move task"
        choices={WORK_STATUSES.map((id) => ({ id, label: WORK_STATUS_LABELS[id] }))}
        selected={[item.status]}
        theme={theme}
        onClose={onClose}
        onSelect={(id) => setStatus(WORK_STATUSES.find((value) => value === id) ?? null)}
      />
    )
  }
  const column = sortByRank(items.filter((task) => task.id !== item.id && task.status === status))
  return (
    <WorkOptions
      key={status}
      title={WORK_STATUS_LABELS[status]}
      choices={[
        { id: '', label: 'End of column' },
        ...column.map((task) => ({ id: task.id, label: `Before ${task.title}` })),
      ]}
      selected={[]}
      theme={theme}
      busy={busy}
      error={error}
      onClose={onClose}
      onSelect={(id) => {
        const index = id ? column.findIndex((task) => task.id === id) : column.length
        if (index < 0) return
        onMove({
          status,
          afterId: column[index - 1]?.id ?? null,
          beforeId: column[index]?.id ?? null,
        })
      }}
    />
  )
}

export function WorkScheduleSheet({
  item,
  theme,
  busy,
  error,
  onClose,
  onSave,
}: {
  item: WorkItem
  theme: Theme
  busy: boolean
  error: string | null
  onClose: () => void
  onSave: (dates: { startDate: string | null; dueDate: string | null }) => void
}) {
  const [start, setStart] = useState(item.startDate ?? '')
  const [due, setDue] = useState(item.dueDate ?? '')
  const [validation, setValidation] = useState<string | null>(null)
  return (
    <WorkSheet title="Schedule task" theme={theme} onClose={onClose}>
      <T style={{ color: theme.muted }}>{item.title}</T>
      <T style={{ color: theme.foreground }}>Start date</T>
      <WorkField
        theme={theme}
        accessibilityLabel="Start date"
        placeholder="YYYY-MM-DD"
        value={start}
        onChangeText={setStart}
        editable={!busy}
      />
      <T style={{ color: theme.foreground }}>Due date</T>
      <WorkField
        theme={theme}
        accessibilityLabel="Due date"
        placeholder="YYYY-MM-DD"
        value={due}
        onChangeText={setDue}
        editable={!busy}
      />
      {validation || error ? (
        <T accessibilityRole="alert" style={{ color: theme.foreground }}>
          {validation ?? error}
        </T>
      ) : null}
      <Button
        theme={theme}
        secondary
        disabled={busy}
        onPress={() => {
          const startDate = start.trim() || null
          const dueDate = due.trim() || null
          const invalid = validateWorkDates(startDate, dueDate)
          setValidation(invalid)
          if (!invalid) onSave({ startDate, dueDate })
        }}
      >
        Save dates
      </Button>
    </WorkSheet>
  )
}
