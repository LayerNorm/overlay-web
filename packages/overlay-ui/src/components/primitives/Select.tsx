"use client"

import { Children, isValidElement, useMemo, useState, type ChangeEvent, type ReactNode, type SelectHTMLAttributes } from 'react'
import { ListboxSelect, type ListboxOption } from './ListboxSelect'

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'onChange' | 'value'> {
  children?: ReactNode
  value?: string | number | readonly string[]
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void
}

function toValue(value: SelectProps['value']): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value === undefined ? undefined : String(value)
}

type OptionNodeProps = { value?: unknown; children?: ReactNode }
type OptionGroupNodeProps = { label?: unknown; children?: ReactNode }

/**
 * JSX like `<option>${amount / 100}/month</option>` gives `children` the array
 * `['$', 8, '/month']`. `String(...)` on that joins with commas — "$,8,/month" —
 * so flatten to text the way the DOM would instead of coercing the array.
 */
function optionLabelFromChildren(children: ReactNode): string {
  const parts: string[] = []
  const visit = (node: ReactNode) => {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (typeof node === 'string' || typeof node === 'number') {
      parts.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (isValidElement<{ children?: ReactNode }>(node)) visit(node.props.children)
  }
  visit(children)
  return parts.join('')
}

function optionsFromChildren(children: ReactNode): ListboxOption<string>[] {
  const options: ListboxOption<string>[] = []
  const appendOptions = (nodes: ReactNode, group?: string) => {
    Children.forEach(nodes, (node) => {
      if (!isValidElement<OptionNodeProps>(node) || node.type !== 'option') return
      const value = String(node.props.value ?? '')
      options.push({ value, label: optionLabelFromChildren(node.props.children) || value, group })
    })
  }
  Children.forEach(children, (child) => {
    if (!isValidElement<OptionNodeProps | OptionGroupNodeProps>(child)) return
    if (child.type === 'option') appendOptions(child)
    if (child.type === 'optgroup') {
      const group = child.props as OptionGroupNodeProps
      appendOptions(group.children, String(group.label ?? ''))
    }
  })
  return options
}

/**
 * Compatibility wrapper for the former native select primitive. It preserves
 * the option-child API while rendering the shared Overlay listbox instead.
 */
export function Select({
  children,
  className,
  defaultValue,
  disabled,
  id,
  name,
  onChange,
  value,
  ...props
}: SelectProps) {
  const options = useMemo(() => optionsFromChildren(children), [children])
  const [uncontrolledValue, setUncontrolledValue] = useState(() => toValue(defaultValue) ?? options[0]?.value ?? '')
  const controlledValue = toValue(value)
  const selectedValue = controlledValue ?? uncontrolledValue

  return (
    <ListboxSelect
      id={id}
      name={name}
      value={selectedValue}
      options={options}
      disabled={disabled}
      // Callers wrote these classes for a native <select>, which is a single
      // element that is both the box and the control, so they belong on the
      // button. Passing them to the wrapper as well painted the border, background
      // and padding twice — a visible box inside a box on every migrated select.
      // The wrapper stays layout-only; the button is already w-full inside it.
      buttonClassName={className}
      aria-label={props['aria-label']}
      aria-describedby={props['aria-describedby']}
      onChange={(nextValue) => {
        if (controlledValue === undefined) setUncontrolledValue(nextValue)
        onChange?.({ target: { value: nextValue } } as ChangeEvent<HTMLSelectElement>)
      }}
    />
  )
}
