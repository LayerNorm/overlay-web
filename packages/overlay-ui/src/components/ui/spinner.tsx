import { cn } from '../../utils/cn'

import { Loader2 } from 'lucide-react'

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}/>
  )
}

export { Spinner }
