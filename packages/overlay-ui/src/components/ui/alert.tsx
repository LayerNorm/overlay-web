import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../utils/cn'

const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-x-3 gap-y-0.5 rounded-lg border px-3 py-2 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current',
  {
    variants: {
      variant: {
        default: 'border-(--border) bg-(--surface-subtle) text-(--foreground)',
        destructive: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

function Alert({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-title" className={cn('col-start-2 font-medium tracking-tight', className)} {...props} />
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-description" className={cn('col-start-2 text-xs leading-5 text-current/90 [&_p]:leading-relaxed', className)} {...props} />
}

export { Alert, AlertTitle, AlertDescription }
