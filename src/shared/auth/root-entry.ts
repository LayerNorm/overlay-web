export const ROOT_APP_DESTINATION = '/app/chat'
export const ROOT_SHOWCASE_DESTINATION = '/app/chat?showcase=1&id=showcase-welcome'

export type RootSessionResolution =
  | 'authenticated'
  | 'unauthenticated'
  | 'transient-error'

export function resolveRootEntryDestination(
  resolution: RootSessionResolution,
): string | null {
  if (resolution === 'authenticated') return ROOT_APP_DESTINATION
  if (resolution === 'unauthenticated') return ROOT_SHOWCASE_DESTINATION
  return null
}

export function classifyRootSessionResponse(input: {
  ok: boolean
  authenticated?: boolean
  hasUser?: boolean
}): RootSessionResolution {
  if (!input.ok) return 'transient-error'
  if (input.authenticated && input.hasUser) return 'authenticated'
  return 'unauthenticated'
}
