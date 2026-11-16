import { v } from 'convex/values'

/** Where an agent thread works: its computer and chosen folders. See src/shared/agents/thread-work.ts. */
export const threadComputerValidator = v.union(
  v.object({ kind: v.literal('cloud') }),
  v.object({ kind: v.literal('mac'), environmentId: v.string() }),
)

export const threadFolderValidator = v.union(
  v.object({ source: v.literal('overlay'), fileId: v.string(), name: v.string() }),
  v.object({ source: v.literal('github'), repository: v.string(), installationId: v.number() }),
  v.object({ source: v.literal('mac'), environmentId: v.string(), path: v.string() }),
)

export const threadWorkValidator = v.object({
  computer: v.optional(threadComputerValidator),
  folders: v.array(threadFolderValidator),
})

/** One file copied onto a computer: where it came from and what it held, to tell what changed afterwards. */
export const folderCopyEntryValidator = v.object({
  path: v.string(),
  fileId: v.string(),
  parentId: v.string(),
  kind: v.union(v.literal('note'), v.literal('text'), v.literal('binary')),
  updatedAt: v.number(),
  sha256: v.string(),
})

/** One folder created while saving back, or that already existed. */
export const folderCopyFolderValidator = v.object({ path: v.string(), fileId: v.string() })
