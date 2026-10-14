'use client'

import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { Search } from 'lucide-react'
import { cn } from '../../utils/cn'
import { Dialog, DialogContent, DialogTitle } from './dialog'

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        'flex min-h-0 w-full flex-col overflow-hidden bg-(--surface-elevated) text-(--foreground)',
        className,
      )}
      {...props}
    />
  )
}

function CommandDialog({
  children,
  title = 'Command palette',
  contentProps,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string
  contentProps?: React.ComponentProps<typeof DialogContent>
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        {...contentProps}
        className={cn(
          'flex max-h-[70vh] w-[calc(100%-2rem)] max-w-xl flex-col gap-0 overflow-hidden rounded-2xl p-0 top-[12vh] translate-y-0',
          contentProps?.className,
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex shrink-0 items-center gap-3 border-b border-(--border) px-4 py-3"
    >
      <Search
        size={16}
        strokeWidth={1.75}
        className="shrink-0 text-(--muted-light)"
        aria-hidden="true"
      />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          'min-w-0 flex-1 border-0 bg-transparent text-sm leading-6 text-(--foreground) outline-hidden placeholder:text-(--muted-light)',
          className,
        )}
        {...props}
      />
    </div>
  )
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn('min-h-0 overflow-y-auto overflow-x-hidden py-1', className)}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn('px-4 py-8 text-center text-xs text-(--muted-light)', className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        '[&_[cmdk-group-heading]]:px-5 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-(--muted-light)',
        className,
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn('h-px bg-(--border)', className)}
      {...props}
    />
  )
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        'flex cursor-pointer items-center gap-3 px-5 py-2 text-left text-sm text-(--muted) transition-colors data-[selected=true]:bg-(--surface-muted) data-[selected=true]:text-(--foreground) data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

function CommandShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn('ml-auto text-xs text-(--muted-light)', className)}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
}
