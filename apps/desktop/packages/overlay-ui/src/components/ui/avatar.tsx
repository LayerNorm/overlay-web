'use client'

import * as React from 'react'
import { Avatar as AvatarPrimitive } from 'radix-ui'

import { cn } from '../../utils/cn'

function Avatar({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return <AvatarPrimitive.Root data-slot="avatar" className={cn('relative flex h-8 w-8 shrink-0 overflow-hidden rounded-full', className)} {...props} />
}

function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return <AvatarPrimitive.Image data-slot="avatar-image" className={cn('aspect-square size-full object-cover', className)} {...props} />
}

function AvatarFallback({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return <AvatarPrimitive.Fallback data-slot="avatar-fallback" className={cn('flex size-full items-center justify-center bg-(--surface-subtle)', className)} {...props} />
}

export { Avatar, AvatarImage, AvatarFallback }
