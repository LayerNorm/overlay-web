import type { ButtonHTMLAttributes } from 'react'

import { Switch } from '../ui/switch'

export interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
}

export function Toggle({
  checked,
  onCheckedChange,
  disabled,
  className,
  type = 'button',
  onClick,
  ...props
}: ToggleProps) {
  return (
    <Switch
      checked={checked}
      disabled={disabled}
      type={type}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) onCheckedChange?.(!checked)
      }}
      className={className}
      {...props}
    />
  )
}
