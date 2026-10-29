import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export type { ClassValue }

export function cn(...values: ClassValue[]): string {
  return twMerge(clsx(...values))
}
