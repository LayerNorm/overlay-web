'use client'
import type { WorkStatus } from '@overlay/app-core/work'
import { WORK_STATUSES, WORK_STATUS_LABELS } from '@/shared/work/status'
import { ListboxSelect } from '@overlay/ui/primitives'

export const workPickerClass =
  'min-h-8 rounded-md border-transparent bg-transparent px-2 py-1 text-xs hover:bg-(--surface-subtle) focus-visible:ring-(--muted-light)'
export function StatusPicker({
  value,
  disabled,
  portal = true,
  label = 'Status',
  onChange,
}: {
  value: WorkStatus
  disabled?: boolean
  portal?: boolean
  label?: string
  onChange: (value: WorkStatus) => void
}) {
  return (
    <ListboxSelect<WorkStatus>
      aria-label={label}
      value={value}
      disabled={disabled}
      portal={portal}
      onChange={onChange}
      className="w-32 max-w-full"
      buttonClassName={workPickerClass}
      options={WORK_STATUSES.map((status) => ({
        value: status,
        label: WORK_STATUS_LABELS[status],
      }))}
    />
  )
}
