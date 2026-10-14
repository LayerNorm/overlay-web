import { useId, type ButtonHTMLAttributes, type HTMLAttributes } from 'react'

import {
  Tabs as TabsPrimitiveRoot,
  TabsList as TabsPrimitiveList,
  TabsTrigger,
} from '../ui/tabs'
import { cn } from '../../utils/cn'

export function TabsList({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <TabsPrimitiveRoot className="contents">
      <TabsPrimitiveList className={className} {...props} />
    </TabsPrimitiveRoot>
  )
}

export interface TabButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  value?: string
}

export function TabButton({
  active,
  type = 'button',
  className,
  value,
  children,
  ...props
}: TabButtonProps) {
  const generatedValue = useId()
  return (
    <TabsTrigger
      type={type}
      value={value ?? generatedValue}
      className={cn(
        active && 'bg-(--surface-elevated) font-medium text-(--foreground) shadow-xs',
        className,
      )}
      {...props}
    >
      {children}
    </TabsTrigger>
  )
}
