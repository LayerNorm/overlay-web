'use client'

import { useImperativeHandle, useRef, useState, type ComponentProps } from 'react'
import { cn } from '../../utils/cn'
import { Select as SelectRoot, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../ui/select'

export interface ListboxOption<T extends string> {
  value: T
  label: string
  /** Optional visual grouping, rendered as a non-selectable heading. */
  group?: string
  disabled?: boolean
}

export interface ListboxSelectProps<T extends string> {
  value: T
  options: ListboxOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
  buttonClassName?: string
  menuClassName?: string
  id?: string
  name?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  placeholder?: string
  /** Defaults to true so the listbox can escape clipping parents. */
  portal?: boolean
  /** Native control attributes used by the option-child compatibility wrapper. */
  triggerProps?: Omit<ComponentProps<typeof SelectTrigger>, 'children' | 'value' | 'className'>
}

export function ListboxSelect<T extends string>({
  value, options, onChange, disabled, className, buttonClassName, menuClassName,
  id, name, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy, placeholder, portal = true, triggerProps,
}: ListboxSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const tabTarget = useRef<HTMLElement | null>(null)
  useImperativeHandle(triggerProps?.ref, () => triggerRef.current!)
  // Disabling an open control closes it permanently, rather than reopening it
  // when an asynchronous busy state clears.
  if (disabled && open) setOpen(false)

  // Radix forbids empty item values. Index IDs also avoid sentinel collisions with
  // arbitrary public values. Only the adapter knows these IDs; forms/callbacks
  // continue using the caller's values (including selectable empty options).
  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = selectedIndex < 0 ? (placeholder ?? value) : options[selectedIndex].label
  const groups = options.reduce<{ group?: string; indices: number[] }[]>((result, option, index) => {
    const last = result.at(-1)
    if (last && last.group === option.group) last.indices.push(index)
    else result.push({ group: option.group, indices: [index] })
    return result
  }, [])

  return (
    <div className={cn('relative min-w-0', className)} onChangeCapture={(event) => {
      // Radix's unnamed internal form control contains private IDs. Do not let
      // its implementation events leak into the caller's form.
      if (event.target instanceof HTMLSelectElement) event.stopPropagation()
    }}>
      {name ? <input type="hidden" name={name} value={value} disabled={disabled} /> : null}
      <SelectRoot
        value={selectedIndex < 0 ? '' : `option-${selectedIndex}`}
        disabled={disabled}
        open={open && !disabled}
        onOpenChange={setOpen}
        onValueChange={(key) => {
          const option = options[Number(key.slice('option-'.length))]
          if (option && !option.disabled) onChange(option.value)
        }}
      >
        <SelectTrigger {...triggerProps} ref={triggerRef} id={id} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} aria-describedby={ariaDescribedBy} className={buttonClassName}>
          <SelectValue placeholder={selected}>{selected}</SelectValue>
        </SelectTrigger>
        <SelectContent
          portal={portal}
          className={cn(!portal && 'z-50', menuClassName)}
          onKeyDown={(event) => {
            // Radix traps Tab by default. Overlay's form controls should close
            // and continue through the form, without escaping an enclosing dialog.
            if (event.key !== 'Tab' || !triggerRef.current) return
            event.preventDefault()
            const trigger = triggerRef.current
            const scope = trigger.closest('[role="dialog"]') ?? document
            const controls = Array.from(scope.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'))
              .filter((node) => node.tabIndex >= 0 && !node.matches(':disabled') && !node.hasAttribute('data-radix-focus-guard') && !event.currentTarget.contains(node) && node.getClientRects().length > 0)
            const index = controls.indexOf(trigger)
            tabTarget.current = controls[index + (event.shiftKey ? -1 : 1)] ?? trigger
            setOpen(false)
          }}
          onCloseAutoFocus={(event) => {
            if (!tabTarget.current) return
            event.preventDefault()
            const target = tabTarget.current
            tabTarget.current = null
            target.focus()
          }}
        >
          {groups.map(({ group, indices }, groupIndex) => (
            <SelectGroup key={groupIndex}>
              {group ? <SelectLabel>{group}</SelectLabel> : null}
              {indices.map((index) => (
                <SelectItem key={`option-${index}`} value={`option-${index}`} disabled={options[index].disabled} textValue={options[index].label}>
                  {options[index].label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </SelectRoot>
    </div>
  )
}

/** @deprecated Prefer {@link ListboxSelect} — kept for package compatibility. */
export type DropdownOption<T extends string> = ListboxOption<T>

/** @deprecated Prefer {@link ListboxSelect} — kept for package compatibility. */
export const DropdownSelect = ListboxSelect
