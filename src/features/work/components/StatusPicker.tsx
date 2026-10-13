'use client'
import type { WorkStatus } from '@overlay/app-core/work'
import { WORK_STATUSES, WORK_STATUS_LABELS } from '@/shared/work/status'
import { z } from 'zod'
const statusSchema = z.enum(WORK_STATUSES)
export function StatusPicker({ value, disabled, label = 'Status', onChange }: { value: WorkStatus; disabled?: boolean; label?: string; onChange: (value: WorkStatus) => void }) {
  return <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(statusSchema.parse(event.target.value))} className="h-8 max-w-32 rounded-md border border-transparent bg-transparent px-2 text-xs text-(--muted) hover:border-(--border) focus:border-(--border) disabled:opacity-50">
    {WORK_STATUSES.map((status) => <option key={status} value={status}>{WORK_STATUS_LABELS[status]}</option>)}
  </select>
}
