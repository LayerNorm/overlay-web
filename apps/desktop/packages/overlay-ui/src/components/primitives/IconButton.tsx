import type { ButtonHTMLAttributes } from 'react'

import { Button } from '../ui/button'
import { cn } from '../../utils/cn'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'h-8 w-8',
  md: 'h-9 w-9',
  lg: 'h-10 w-10',
} as const

export function IconButton({
  size = 'md',
  type = 'button',
  className,
  ...props
}: IconButtonProps) {
  return (
    <Button
      type={type}
      variant="ghost"
      size="icon"
      className={cn(sizeClasses[size], className)}
      {...props}
    />
  )
}
