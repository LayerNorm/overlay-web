export const AVATAR_COLORS = ['#64748b', '#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626']

export function parseRoots(value: string) {
  return value.split(/[,\n]/).map((root) => root.trim()).filter(Boolean)
}
