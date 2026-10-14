/** Where a task's context reference opens. Files, notes, and chats are app pages; a link is the address itself. */
import type { WorkContextRef } from '@overlay/app-core'

/** Only web addresses are ever opened from a link (never `javascript:` or similar). */
export function safeLinkUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

/** The label to suggest for a pasted address: its host, without `www.`. */
export function labelForLink(value: string): string {
  const url = safeLinkUrl(value)
  return url ? new URL(url).hostname.replace(/^www\./, '') : value.trim()
}

export function hrefForContext(ref: Pick<WorkContextRef, 'type' | 'id'>): string | null {
  const id = encodeURIComponent(ref.id)
  switch (ref.type) {
    case 'chat': return `/app/chat?id=${id}`
    case 'note': return `/app/notes?id=${id}`
    case 'file': return `/app/files?file=${id}`
    case 'link': return safeLinkUrl(ref.id)
    default: return null
  }
}
