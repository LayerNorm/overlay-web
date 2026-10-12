import {
  AUTOMATIONS_UPDATED_EVENT,
  EXTENSIONS_CHANGED_EVENT,
  KNOWLEDGE_RECONCILE_EVENT,
  MCPS_CHANGED_EVENT,
  SKILLS_CHANGED_EVENT,
  type ScopedResourceKind,
} from '@overlay/app-core'

export const ARCHIVE_TOAST_EVENT = 'overlay:archive-toast'

export const ARCHIVED_SETTINGS_HREF = '/app/settings?section=archived'

export interface ArchiveToastDetail {
  /** What was archived, e.g. "Q3 plan". */
  name: string
  /** Replaces the default "Archived “name”" text, e.g. for several items at once. */
  summary?: string
  /** Puts it back. Omitted when the archive cannot be undone from here. */
  undo?: () => Promise<void>
  /** Called after the archive was undone, so a list can refresh. */
  onUndone?: () => void
}

/** Tells the person something was archived, with Undo and a link to Settings → Archived. */
export function announceArchived(detail: ArchiveToastDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<ArchiveToastDetail>(ARCHIVE_TOAST_EVENT, { detail }))
}

/** Lists showing this kind of resource reload, so a restored item reappears where it belongs. */
export function refreshAfterRestore(resource: ScopedResourceKind): void {
  if (typeof window === 'undefined') return
  if (resource === 'files') window.dispatchEvent(new Event(KNOWLEDGE_RECONCILE_EVENT))
  else if (resource === 'automations') window.dispatchEvent(new Event(AUTOMATIONS_UPDATED_EVENT))
  else if (resource === 'skills') {
    window.dispatchEvent(new CustomEvent(SKILLS_CHANGED_EVENT))
    window.dispatchEvent(new CustomEvent(EXTENSIONS_CHANGED_EVENT))
  } else if (resource === 'mcp-servers') {
    window.dispatchEvent(new CustomEvent(MCPS_CHANGED_EVENT))
    window.dispatchEvent(new CustomEvent(EXTENSIONS_CHANGED_EVENT))
  }
}
