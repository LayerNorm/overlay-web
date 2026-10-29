'use client'

import * as React from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { cn } from '../../utils/cn'
import { floatingLayerClassName, floatingSurfaceClassName } from './floating-surface'

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverAnchor = PopoverPrimitive.Anchor
const PopoverClose = PopoverPrimitive.Close

const PopoverContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContent({ className, sideOffset = 6, collisionPadding = 8, ...props }, ref) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        data-slot="popover-content"
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          floatingSurfaceClassName,
          floatingLayerClassName,
          'max-h-(--radix-popover-content-available-height)',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
})

export { Popover, PopoverTrigger, PopoverAnchor, PopoverClose, PopoverContent }
