/** Pages under More unless a person pins them to the primary sidebar. */
export const DEFAULT_SIDEBAR_MORE_PAGE_IDS: readonly string[] = ['files', 'extensions', 'automations']

export const MAX_SIDEBAR_PAGE_IDS = 24
const SIDEBAR_PAGE_ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/

export function isSidebarPageIdList(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= MAX_SIDEBAR_PAGE_IDS
    && value.every((id) => typeof id === 'string' && SIDEBAR_PAGE_ID_PATTERN.test(id))
}

export interface SidebarLayout {
  pinned: string[]
  more: string[]
}

/**
 * Where each available page sits. An empty `pinned` means the person never customized the sidebar. A page in
 * neither saved list (one added later, or one a feature flag just turned on) lands in its default place, and the
 * sidebar always keeps at least one page.
 */
export function resolveSidebarLayout(
  availableIds: readonly string[],
  saved: { pinned?: readonly string[]; more?: readonly string[] } = {},
  defaultMoreIds: readonly string[] = DEFAULT_SIDEBAR_MORE_PAGE_IDS,
): SidebarLayout {
  const customized = (saved.pinned?.length ?? 0) > 0
  const unique = (ids: readonly string[] | undefined) => Array.from(new Set(ids ?? [])).filter((id) => availableIds.includes(id))
  const pinned = customized ? unique(saved.pinned) : []
  const more = customized ? unique(saved.more).filter((id) => !pinned.includes(id)) : []
  for (const id of availableIds) {
    if (pinned.includes(id) || more.includes(id)) continue
    if (defaultMoreIds.includes(id)) more.push(id)
    else pinned.push(id)
  }
  if (pinned.length === 0 && more.length > 0) pinned.push(more.shift()!)
  return { pinned, more }
}

/** Moves one page to a position in either list. Returns the same layout when the move would empty the sidebar. */
export function moveSidebarPage(layout: SidebarLayout, id: string, list: keyof SidebarLayout, index: number): SidebarLayout {
  if (list === 'more' && layout.pinned.length === 1 && layout.pinned[0] === id) return layout
  const next: SidebarLayout = { pinned: layout.pinned.filter((entry) => entry !== id), more: layout.more.filter((entry) => entry !== id) }
  next[list].splice(Math.max(0, Math.min(index, next[list].length)), 0, id)
  return next
}

/** The page the app opens to: the first page a person pinned that still exists, else the fallback. */
export function sidebarLandingHref(
  navigation: ReadonlyArray<{ id: string; href: string }>,
  pinned: readonly string[] | undefined,
  fallbackHref: string,
): string {
  for (const id of pinned ?? []) {
    const page = navigation.find((item) => item.id === id)
    if (page) return page.href
  }
  return fallbackHref
}
