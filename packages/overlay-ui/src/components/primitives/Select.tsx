"use client"

import { Children, isValidElement, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode, type SelectHTMLAttributes } from 'react'
import { ListboxSelect, type ListboxOption, type ListboxSelectProps } from './ListboxSelect'

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'onChange' | 'value'> {
  children?: ReactNode
  value?: string | number | readonly string[]
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void
}

function toValue(value: SelectProps['value']): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value === undefined ? undefined : String(value)
}

type OptionNodeProps = { value?: unknown; children?: ReactNode; disabled?: boolean; label?: string }
type OptionGroupNodeProps = { label?: unknown; children?: ReactNode; disabled?: boolean }

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
  const appendOptions = (nodes: ReactNode, group?: string, groupDisabled?: boolean) => {
    Children.forEach(nodes, (node) => {
      if (!isValidElement<OptionNodeProps>(node) || node.type !== 'option') return
      const text = optionLabelFromChildren(node.props.children)
      const value = String(node.props.value ?? text)
      options.push({ value, label: node.props.label ?? (text || value), group, disabled: groupDisabled || node.props.disabled })
    })
  }
  Children.forEach(children, (child) => {
    if (!isValidElement<OptionNodeProps | OptionGroupNodeProps>(child)) return
    if (child.type === 'option') appendOptions(child)
    if (child.type === 'optgroup') {
      const group = child.props as OptionGroupNodeProps
      appendOptions(group.children, String(group.label ?? ''), group.disabled)
    }
  })
  return options
}

/** Option-child API backed by Radix; the native bridge owns form semantics. */
export function Select(props: SelectProps) {
  // Radix Select is single-value only. Keep actual native multi-selection and
  // visible listboxes narrowly native rather than changing their semantics.
  if (props.multiple || (props.size !== undefined && props.size > 1)) {
    return <select {...props} />
  }
  return <SingleSelect {...props} />
}

function SingleSelect({ children, className, defaultValue, disabled, id, name, onChange, value, ...props }: SelectProps) {
  const options = useMemo(() => optionsFromChildren(children), [children])
  const initialValue = toValue(defaultValue) ?? options.find((option) => !option.disabled)?.value ?? ''
  const [uncontrolledValue, setUncontrolledValue] = useState(initialValue)
  const controlledValue = toValue(value)
  const selectedValue = controlledValue ?? uncontrolledValue
  const nativeRef = useRef<HTMLSelectElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const form = nativeRef.current?.form
    const reset = (event: Event) => {
      // Wait for other listeners to cancel a reset before updating React state.
      queueMicrotask(() => {
        if (event.defaultPrevented) return
        if (nativeRef.current) nativeRef.current.value = controlledValue ?? initialValue
        if (controlledValue === undefined) setUncontrolledValue(initialValue)
      })
    }
    form?.addEventListener('reset', reset)
    return () => form?.removeEventListener('reset', reset)
  }, [controlledValue, initialValue, props.form])

  // These attributes describe the visible control. Form attributes and native
  // change/invalid events stay on the real select, with original option values.
  const triggerProps = {
    ...props,
    ref: triggerRef,
    name: undefined,
    form: undefined,
    required: undefined,
    autoComplete: undefined,
    onInvalid: undefined,
    'aria-required': props.required || undefined,
  } as unknown as ListboxSelectProps<string>['triggerProps']

  return (
    <>
      <ListboxSelect
        id={id}
        value={selectedValue}
        options={options}
        disabled={disabled}
        buttonClassName={className}
        aria-label={props['aria-label']}
        aria-labelledby={props['aria-labelledby']}
        aria-describedby={props['aria-describedby']}
        triggerProps={triggerProps}
        onChange={(nextValue) => {
          const native = nativeRef.current
          if (!native) return
          native.value = nextValue
          native.dispatchEvent(new Event('change', { bubbles: true }))
        }}
      />
      <select
        ref={nativeRef}
        name={name}
        form={props.form}
        required={props.required}
        autoComplete={props.autoComplete}
        disabled={disabled}
        value={selectedValue}
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
        onInvalid={(event) => {
          props.onInvalid?.(event)
          event.preventDefault()
          triggerRef.current?.focus()
        }}
        onChange={(event) => {
          if (controlledValue === undefined) setUncontrolledValue(event.target.value)
          onChange?.(event)
        }}
      >
        {!options.some((option) => option.value === selectedValue) ? <option value={selectedValue} hidden>{selectedValue}</option> : null}
        {children}
      </select>
    </>
  )
}
