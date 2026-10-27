export function identityInitials(name: string, fallback = 'U'): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]?.toUpperCase()).join('') || fallback
}
