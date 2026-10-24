import { z } from 'zod/v3'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { FileLinkNode } from '@overlay/app-core/file-markdown-links'
import type { ResourceScope } from '@overlay/app-core'

const linkNode = z.object({
  _id: z.string().min(1).optional(), id: z.string().min(1).optional(),
  name: z.string(), type: z.string(), kind: z.string().optional(),
  parentId: z.string().nullable().default(null), scope: z.enum(['personal', 'workspace']).default('personal'),
  userId: z.string().optional(), archivedAt: z.number().nullish().transform(value => value ?? undefined),
}).transform(({ _id, id, ...rest }, context) => {
  const key = _id ?? id
  if (!key || (_id && id && _id !== id)) {
    context.addIssue({ code: 'custom', message: 'File identifier is missing or inconsistent' })
    return z.NEVER
  }
  return { ...rest, _id: key }
})
const page = z.object({ data: z.array(linkNode).max(100), hasMore: z.boolean(), nextCursor: z.string().nullish() })

export async function readFileLinkChildren({ parentId, scope, signal, files = overlayAppClient.files }: {
  parentId: string | null
  scope: ResourceScope
  signal: AbortSignal
  files?: Pick<typeof overlayAppClient.files, 'getPage'>
}): Promise<FileLinkNode[]> {
  const rows: FileLinkNode[] = [], cursors = new Set<string>()
  let cursor: string | undefined
  for (let index = 0; index < 20; index++) {
    const result = page.parse(await files.getPage<unknown>({
      parentId: parentId ?? 'null', view: scope, summary: true, limit: 100, cursor,
    }, { signal }))
    rows.push(...result.data)
    if (!result.hasMore) return rows
    if (!result.nextCursor || cursors.has(result.nextCursor)) throw new Error('File listing is incomplete')
    cursor = result.nextCursor
    cursors.add(cursor)
  }
  throw new Error('File listing exceeds the link lookup limit')
}
