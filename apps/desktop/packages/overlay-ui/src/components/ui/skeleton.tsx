import * as React from 'react'

import { cn } from '../../utils/cn'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="skeleton" className={cn('ui-skeleton-line rounded-md', className)} {...props} />
}

export { Skeleton }
