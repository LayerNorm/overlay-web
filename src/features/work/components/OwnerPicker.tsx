'use client'
import { ListboxSelect } from '@overlay/ui/primitives'
import { workPickerClass } from './StatusPicker'
import type { WorkPerson } from '@overlay/app-core/work'
export type { WorkPerson } from '@overlay/app-core/work'
export function OwnerPicker({
  value,
  people,
  disabled,
  portal = true,
  label = 'Owner',
  onChange,
}: {
  value?: string
  people: readonly WorkPerson[]
  disabled?: boolean
  portal?: boolean
  label?: string
  onChange: (value: string | null) => void
}) {
  return (
    <ListboxSelect
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      portal={portal}
      onChange={(value) => onChange(value || null)}
      className="w-32 max-w-full"
      buttonClassName={workPickerClass}
      options={[
        { value: '', label: 'Unassigned' },
        ...(value && !people.some((person) => person.principalId === value)
          ? [{ value, label: 'Unavailable member' }]
          : []),
        ...people.map((person) => ({
          value: person.principalId,
          label: person.name,
        })),
      ]}
    />
  )
}
