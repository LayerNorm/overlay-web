import type { WorkContext } from '@overlay/app-core/work'
export function workContextHref(ref: WorkContext, workspaceId: string) {
  if (ref.type === 'link') {
    try {
      const url = new URL(ref.id)
      return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined
    } catch {
      return undefined
    }
  }
  const root = `/app/w/${encodeURIComponent(workspaceId)}`
  return ref.type === 'chat'
    ? `${root}/chat?id=${encodeURIComponent(ref.id)}`
    : ref.type === 'note'
      ? `${root}/notes?id=${encodeURIComponent(ref.id)}`
      : `${root}/files?file=${encodeURIComponent(ref.id)}`
}
