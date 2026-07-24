import { desktopAppJson, unwrapPaginatedData } from './app-api-client'

export interface NoteMeta {
  id: string
  title: string
  updatedAt: number
}

export interface RemoteFile {
  _id: string
  clientId?: string
  name: string
  type: 'file' | 'folder'
  kind?: 'folder' | 'note' | 'upload' | 'output'
  content?: string
  textContent?: string
  previewText?: string
  mimeType?: string
  extension?: string
  parentId?: string | null
  createdAt?: number
  updatedAt?: number
}

export interface FileListItem {
  id: string
  remoteId?: string
  name: string
  type: 'file' | 'folder' | 'note'
  kind?: RemoteFile['kind']
  mimeType?: string
  extension?: string
  pathLabel?: string
  updatedAt: number
  source: 'backend' | 'local-note' | 'local-document'
}

export interface LocalDocument {
  id: string
  filename: string
  filepath: string
  mimeType: string
  chunkCount: number
  createdAt: number
}

interface FilesListBridge {
  loadNotes(): Promise<NoteMeta[]>
  document: {
    getAll(limit: number): Promise<LocalDocument[]>
  }
}

interface FetchDesktopFileListOptions {
  force?: boolean
  authority?: 'cloud' | 'on-this-mac'
  bridge?: FilesListBridge
  fetchRemoteFiles?: () => Promise<RemoteFile[]>
}

let cachedFiles: FileListItem[] | null = null
let cachedAuthority: FetchDesktopFileListOptions['authority'] | null = null
let inFlight: Promise<FileListItem[]> | null = null

export function remoteFileToItem(file: RemoteFile, localNote?: NoteMeta): FileListItem {
  const type =
    file.type === 'folder' || file.kind === 'folder'
      ? 'folder'
      : file.kind === 'note'
        ? 'note'
        : 'file'
  return {
    id: localNote?.id ?? (type === 'note' && file.clientId ? file.clientId : file._id),
    remoteId: file._id,
    name: localNote?.title || file.name || 'Untitled',
    type,
    kind: file.kind,
    mimeType: file.mimeType,
    extension: file.extension,
    pathLabel:
      type === 'folder'
        ? 'Folder'
        : file.kind === 'note'
          ? 'Note'
          : file.kind === 'output'
            ? 'Output'
            : 'File',
    updatedAt: Math.max(localNote?.updatedAt ?? 0, file.updatedAt ?? file.createdAt ?? 0),
    source: 'backend'
  }
}

export function localNoteToItem(note: NoteMeta): FileListItem {
  return {
    id: note.id,
    name: note.title || 'Untitled',
    type: 'note',
    pathLabel: 'On this Mac · Note',
    updatedAt: note.updatedAt,
    source: 'local-note'
  }
}

export function localDocumentToItem(document: LocalDocument): FileListItem {
  return {
    id: document.id,
    name: document.filename || 'Untitled',
    type: 'file',
    mimeType: document.mimeType,
    pathLabel: 'On this Mac · Indexed document',
    updatedAt: document.createdAt,
    source: 'local-document'
  }
}

export function getCachedDesktopFileList(
  authority?: FetchDesktopFileListOptions['authority']
): FileListItem[] | null {
  if (authority && cachedAuthority !== authority) return null
  return cachedFiles
}

export function setCachedDesktopFileList(
  files: readonly FileListItem[],
  authority?: FetchDesktopFileListOptions['authority']
): void {
  cachedFiles = [...files]
  cachedAuthority = authority ?? cachedAuthority
}

export async function fetchDesktopFileList(
  options: FetchDesktopFileListOptions = {}
): Promise<FileListItem[]> {
  const authority = options.authority ?? 'cloud'
  if (!options.force && cachedFiles && cachedAuthority === authority) return cachedFiles
  if (inFlight) return inFlight

  const bridge = options.bridge ?? window.bridge
  const fetchRemoteFiles =
    options.fetchRemoteFiles ??
    (async () => {
      const value = await desktopAppJson<RemoteFile[] | { data: RemoteFile[] }>('/api/v1/files')
      return unwrapPaginatedData<RemoteFile>(value)
    })

  const request =
    authority === 'cloud'
      ? fetchRemoteFiles().then((remoteFiles) => remoteFiles.map((file) => remoteFileToItem(file)))
      : Promise.all([
          bridge.loadNotes().catch((error) => {
            console.warn('[FilesListCache] Failed to load local notes:', error)
            return []
          }),
          bridge.document.getAll(250).catch((error) => {
            console.warn('[FilesListCache] Failed to load local indexed documents:', error)
            return []
          })
        ]).then(([localNotes, localDocuments]) => [
          ...localNotes.map(localNoteToItem),
          ...localDocuments.map(localDocumentToItem)
        ])

  inFlight = request
    .then((files) => {
      cachedFiles = files
      cachedAuthority = authority
      return cachedFiles
    })
    .finally(() => {
      inFlight = null
    })

  return inFlight
}
