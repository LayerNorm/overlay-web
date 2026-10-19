import * as React from 'react'
import { Slot } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../utils/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm'

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-(--foreground) text-(--background) hover:opacity-90',
        secondary: 'border border-(--border) bg-(--surface-subtle) text-(--foreground) hover:bg-(--border)',
        ghost: 'bg-transparent text-(--muted) hover:bg-(--surface-subtle) hover:text-(--foreground)',
        danger: 'bg-red-500 text-white hover:opacity-90',
      },
      size: {
        xs: 'h-6 gap-1 rounded-md px-2 text-xs',
        sm: 'h-8 rounded-md px-3 text-xs',
        md: 'h-9 rounded-lg px-4 text-sm',
        lg: 'h-10 rounded-xl px-5 text-sm',
        icon: 'h-9 w-9 rounded-lg p-0',
        'icon-xs': 'size-6 rounded-md p-0 [&_svg:not([class*=size-])]:size-3.5',
        'icon-sm': 'size-8 rounded-lg p-0 [&_svg:not([class*=size-])]:size-4',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  },
)

export interface ButtonProps
  extends React.ComponentProps<'button'>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

function Button({
  className,
  variant,
  size,
  type = 'button',
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      data-slot="button"
      type={asChild ? undefined : type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Button, buttonVariants }
