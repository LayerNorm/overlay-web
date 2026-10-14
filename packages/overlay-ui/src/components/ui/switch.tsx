'use client'

import * as React from 'react'
import { Switch as SwitchPrimitive } from 'radix-ui'

import { cn } from '../../utils/cn'

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-(--foreground)/20 disabled:cursor-not-allowed disabled:opacity-70 data-[state=checked]:border-(--muted) data-[state=checked]:bg-(--muted) data-[state=unchecked]:border-(--border) data-[state=unchecked]:bg-(--surface-subtle)',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="block h-5 w-5 rounded-full bg-(--surface-elevated) transition-transform data-[state=checked]:translate-x-6 data-[state=unchecked]:translate-x-1"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
