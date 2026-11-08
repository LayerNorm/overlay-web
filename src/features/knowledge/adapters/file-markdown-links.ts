import type { ConvexReactClient } from 'convex/react'
import type { FileLinkNode } from '@overlay/app-core/file-markdown-links'
import type { ResourceScope } from '@overlay/app-core'
import { api } from '../../../../convex/_generated/api'

/** One folder's readable children (the root for null) in a view, from the native `files/browse:children` query. */
export async function readFileLinkChildren({ convex, workspaceId, parentId, scope }: {
  convex: Pick<ConvexReactClient, 'query'>
  workspaceId: string
  parentId: string | null
  scope: ResourceScope
}): Promise<FileLinkNode[]> {
  const listing = await convex.query(api.files.browse.children, { workspaceId, parentId, view: scope === 'workspace' ? 'workspace' : 'personal' })
  if (!listing) throw new Error('File listing is unavailable')
  // A partial listing could hide the target or a same-named sibling, so links in it are not resolved.
  if (!listing.complete) throw new Error('File listing is too large to resolve links')
  return listing.files.map((row) => ({ ...row, parentId: row.parentId ?? null })) as FileLinkNode[]
}
