'use client'

import * as React from 'react'
import { Tabs as TabsPrimitive } from 'radix-ui'

import { cn } from '../../utils/cn'

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-2', className)} {...props} />
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('inline-flex rounded-lg bg-(--surface-subtle) p-0.5', className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex items-center justify-center rounded-md px-2.5 py-1 text-xs text-(--muted) transition-colors outline-hidden hover:text-(--foreground) focus-visible:ring-2 focus-visible:ring-(--foreground)/20 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-(--surface-elevated) data-[state=active]:font-medium data-[state=active]:text-(--foreground) data-[state=active]:shadow-xs',
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('flex-1 outline-hidden', className)} {...props} />
}

export { Tabs, TabsContent, TabsList, TabsTrigger }
