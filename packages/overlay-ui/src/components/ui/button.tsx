import * as React from 'react'
import { Slot } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../utils/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'link' | 'danger'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm' | 'icon-xs'

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:opacity-90',
        secondary: 'border border-(--border) bg-secondary text-secondary-foreground hover:bg-(--border)',
        outline: 'border border-(--border) bg-transparent text-(--foreground) hover:bg-(--surface-subtle)',
        ghost: 'bg-transparent text-muted-foreground hover:bg-(--surface-subtle) hover:text-(--foreground)',
        link: 'bg-transparent text-(--foreground) underline-offset-2 hover:underline',
        danger: 'bg-red-500 text-white hover:opacity-90',
      },
      size: {
        xs: 'h-7 rounded-md px-2.5 text-xs',
        sm: 'h-8 rounded-md px-3 text-xs',
        md: 'h-9 rounded-lg px-4 text-sm',
        lg: 'h-10 rounded-xl px-5 text-sm',
        icon: 'h-9 w-9 rounded-lg p-0',
        'icon-sm': 'h-8 w-8 rounded-md p-0',
        'icon-xs': 'h-7 w-7 rounded-md p-0',
      },
    },
    compoundVariants: [{ variant: 'link', class: 'h-auto rounded-none p-0' }],
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
