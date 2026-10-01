/** Avatar body colors offered by the avatar picker. */
export const AVATAR_COLORS = [
  '#f5f5f4', '#8a6240', '#dc2626', '#ea580c', '#f59e0b', '#16a34a',
  '#14b8a6', '#2563eb', '#7c3aed', '#db2777', '#64748b',
]

/** Body color for agents saved without one. */
export const AVATAR_FALLBACK_COLOR = '#64748b'

export function parseRoots(value: string) {
  return value.split(/[,\n]/).map((root) => root.trim()).filter(Boolean)
}
