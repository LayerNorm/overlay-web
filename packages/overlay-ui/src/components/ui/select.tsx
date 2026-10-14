'use client'

import * as React from 'react'
import { Select as SelectPrimitive } from 'radix-ui'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '../../utils/cn'

const Select = SelectPrimitive.Root
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value
const SelectPortal = SelectPrimitive.Portal

function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        'group flex min-h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-(--border) bg-(--surface-subtle) px-3 py-1.5 text-left text-sm text-(--foreground) outline-hidden transition-colors enabled:hover:bg-(--surface-muted) focus-visible:ring-1 focus-visible:ring-(--foreground) disabled:cursor-not-allowed disabled:text-(--muted-light) [&>span]:min-w-0 [&>span]:truncate',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown size={11} className="shrink-0 transition-transform group-data-[state=open]:rotate-180" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectScrollUpButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return <SelectPrimitive.ScrollUpButton data-slot="select-scroll-up-button" className={cn('flex items-center justify-center py-1 text-(--muted)', className)} {...props}><ChevronUp size={11} /></SelectPrimitive.ScrollUpButton>
}

function SelectScrollDownButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return <SelectPrimitive.ScrollDownButton data-slot="select-scroll-down-button" className={cn('flex items-center justify-center py-1 text-(--muted)', className)} {...props}><ChevronDown size={11} /></SelectPrimitive.ScrollDownButton>
}

/** Portal is optional for the legacy ListboxSelect portal=false contract. */
function SelectContent({ className, children, position = 'popper', sideOffset = 4, portal = true, ...props }: React.ComponentProps<typeof SelectPrimitive.Content> & { portal?: boolean }) {
  const content = (
    <SelectPrimitive.Content
      data-slot="select-content"
      position={position}
      sideOffset={sideOffset}
      collisionPadding={8}
      className={cn(
        'overlay-pop-in z-10090 max-h-[min(240px,var(--radix-select-content-available-height))] w-(--radix-select-trigger-width) max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border border-(--border) bg-(--surface-elevated) py-1 shadow-lg',
        className,
      )}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport data-slot="select-viewport" className="w-full">{children}</SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  )
  return portal ? <SelectPortal>{content}</SelectPortal> : content
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return <SelectPrimitive.Label data-slot="select-label" className={cn('px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-light)', className)} {...props} />
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn('relative flex w-full cursor-default select-none items-center px-3 py-2 text-left text-sm text-(--muted) outline-hidden transition-colors data-[state=checked]:bg-(--surface-muted) data-[state=checked]:font-medium data-[state=checked]:text-(--foreground) data-[highlighted]:bg-(--surface-muted) data-[highlighted]:text-(--foreground) data-[disabled]:pointer-events-none data-[disabled]:text-(--muted-light)', className)}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator data-slot="select-separator" className={cn('my-1 h-px bg-(--border)', className)} {...props} />
}

export { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectPortal, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger, SelectValue }
