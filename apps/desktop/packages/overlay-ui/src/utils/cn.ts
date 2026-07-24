export type ClassValue =
  | string
  | number
  | false
  | null
  | undefined
  | ClassValue[]
  | Record<string, boolean | null | undefined>

export function cn(...values: ClassValue[]): string {
  const classes: string[] = []

  for (const value of values) {
    if (!value) continue

    if (typeof value === 'string' || typeof value === 'number') {
      classes.push(String(value))
      continue
    }

    if (Array.isArray(value)) {
      const nested = cn(...value)
      if (nested) classes.push(nested)
      continue
    }

    for (const [key, enabled] of Object.entries(value)) {
      if (enabled) classes.push(key)
    }
  }

  return classes.join(' ')
}
