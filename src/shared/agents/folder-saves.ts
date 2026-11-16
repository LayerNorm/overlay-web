/**
 * The card on an agent's reply that lists what a run saved back to Files and the pull requests it opened
 * (internal/develop/thread-folders.md). Stored as a `data-folder-saves` message part.
 */
export const FOLDER_SAVES_PART = 'data-folder-saves'

export type FolderSaveAction = 'created' | 'updated' | 'deleted' | 'saved_as_copy'

export type FolderSavesData = {
  version: 1
  folders: Array<{
    folderId: string
    folderName: string
    saved: Array<{ path: string; action: FolderSaveAction; fileId?: string }>
    failed: Array<{ path: string; reason: string }>
    skipped: string[]
  }>
  pullRequests: Array<{ repository: string; number: number; title: string; url: string; branch: string }>
}

const isString = (value: unknown): value is string => typeof value === 'string'
const ACTIONS = new Set<FolderSaveAction>(['created', 'updated', 'deleted', 'saved_as_copy'])

/** Reads the card from a stored message part, dropping anything malformed. */
export function readFolderSaves(value: unknown): FolderSavesData | null {
  const data = value as Partial<FolderSavesData> | null
  if (!data || data.version !== 1 || !Array.isArray(data.folders) || !Array.isArray(data.pullRequests)) return null
  const folders = data.folders.flatMap((folder) => {
    if (!folder || !isString(folder.folderId) || !isString(folder.folderName)) return []
    return [{
      folderId: folder.folderId,
      folderName: folder.folderName,
      saved: (Array.isArray(folder.saved) ? folder.saved : []).filter((item) => item && isString(item.path) && ACTIONS.has(item.action)),
      failed: (Array.isArray(folder.failed) ? folder.failed : []).filter((item) => item && isString(item.path) && isString(item.reason)),
      skipped: (Array.isArray(folder.skipped) ? folder.skipped : []).filter(isString),
    }]
  })
  const pullRequests = data.pullRequests.filter((pull) => pull && isString(pull.repository) && typeof pull.number === 'number'
    && isString(pull.title) && isString(pull.url) && pull.url.startsWith('https://github.com/'))
  return { version: 1, folders, pullRequests }
}
