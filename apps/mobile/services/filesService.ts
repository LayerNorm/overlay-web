import type { KnowledgeFile } from '@overlay/app-core'
import {
  api,
  convexWorkspaceId,
  mutateConvex,
  queryConvex,
  subscribeConvex,
  type Id,
} from './convexClient'

export type FileView = 'personal' | 'workspace' | 'archived'
export function subscribeFiles(
  workspaceId: string,
  onValue: (files: KnowledgeFile[] | null) => void,
  onError: (error: unknown) => void,
  view?: FileView,
) {
  return subscribeConvex(
    api.files.browse.list,
    { workspaceId, ...(view ? { view } : {}) },
    onValue,
    onError,
  )
}
export function listFiles(view?: FileView) {
  return queryConvex(api.files.browse.list, {
    workspaceId: convexWorkspaceId(),
    ...(view ? { view } : {}),
  })
}
export function getFile(fileId: string) {
  return queryConvex(api.files.browse.get, {
    workspaceId: convexWorkspaceId(),
    fileId: fileId as Id<'files'>,
  })
}
export function fileChildren(parentId: string | null, view: 'personal' | 'workspace') {
  return queryConvex(api.files.browse.children, {
    workspaceId: convexWorkspaceId(),
    parentId,
    view,
  })
}
export function conversationFiles(conversationId: string) {
  return queryConvex(api.files.browse.forConversation, {
    workspaceId: convexWorkspaceId(),
    conversationId,
  })
}
export async function renameFile(fileId: string, name: string) {
  if (!name.trim()) throw new Error('Enter a file name.')
  await mutateConvex(api.files.browse.rename, {
    workspaceId: convexWorkspaceId(),
    fileId: fileId as Id<'files'>,
    name: name.trim(),
  })
}
export async function moveFile(fileId: string, parentId: string | null) {
  await mutateConvex(api.files.browse.move, {
    workspaceId: convexWorkspaceId(),
    fileId: fileId as Id<'files'>,
    parentId: parentId as Id<'files'> | null,
  })
}
