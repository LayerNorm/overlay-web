/**
 * The name a person's first workspace starts with, until they rename it: "<First name>'s workspace".
 * Falls back to the start of their email, then to "My workspace". Never "Personal".
 */
export function defaultWorkspaceName(args: { displayName?: string | null; email?: string | null }): string {
  const fromName = firstName(args.displayName)
  if (fromName) return `${fromName}’s workspace`
  // An email may arrive as the display name itself.
  const email = args.email?.trim() || (args.displayName?.includes('@') ? args.displayName : '')
  const local = email?.trim().split('@')[0]?.split(/[._+-]/)[0]?.trim()
  if (local) return `${capitalize(local)}’s workspace`
  return 'My workspace'
}

/** Names the early versions gave every first workspace: stand-ins, not choices. */
export function isGenericWorkspaceName(name: string): boolean {
  return /^personal(?:[’']s workspace)?$/i.test(name.trim())
}

/** True for a name nobody chose: the generated "<Name>’s workspace", "My workspace", or an early stand-in. */
export function isStartingWorkspaceName(name: string): boolean {
  return isGenericWorkspaceName(name) || /^My workspace$/i.test(name.trim()) || /^\S+[’']s workspace$/.test(name.trim())
}

function firstName(displayName?: string | null): string | null {
  const value = displayName?.trim()
  // An email address or a stand-in is not a name.
  if (!value || value.includes('@') || /^personal$/i.test(value)) return null
  const first = value.split(/\s+/)[0]
  return first ? capitalize(first) : null
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
