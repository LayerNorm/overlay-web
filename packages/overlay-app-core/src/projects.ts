import type { ConversationSummary, CreateFileRequest, KnowledgeFile, ProjectSummary } from './contracts'
import { canMoveKnowledgeFile, opensInDocumentEditor } from './knowledge'
export { NOTES_CHANGED_EVENT } from './notes'

export const PROJECT_META_UPDATED_EVENT = 'overlay:project-meta-updated'
export const PROJECTS_CHANGED_EVENT = 'overlay:projects-changed'

export type ProjectRouteView = 'chat' | 'note' | 'file'
export type ProjectHubTab = 'chats' | 'files' | 'instructions'

export interface ProjectMetaUpdatedDetail {
  projectId?: string
  name?: string
}

export interface ProjectChatSummary {
  _id: string
  title: string
  updatedAt?: number
  lastModified?: number
}

export interface ProjectNoteSummary {
  _id: string
  title: string
  updatedAt?: number
}

export interface ProjectFileSummary extends Pick<
  KnowledgeFile,
  '_id' | 'name' | 'type' | 'kind' | 'mimeType' | 'extension' | 'parentId' | 'updatedAt'
> {
  shareVisibility?: 'private' | 'public'
  shareToken?: string | null
  content?: string
  textContent?: string
}

export interface ProjectResourceItems {
  chats: ProjectChatSummary[]
  notes: ProjectNoteSummary[]
  files: ProjectFileSummary[]
}

export type ProjectUploadFileType =
  | 'text'
  | 'markdown'
  | 'csv'
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'document'
  | 'binary'

export function projectHubHref(project: Pick<ProjectSummary, '_id' | 'name'>): string {
  return `/app/projects?projectId=${encodeURIComponent(project._id)}&projectName=${encodeURIComponent(project.name)}`
}

export function projectItemHref({
  project,
  view,
  id,
}: {
  project: Pick<ProjectSummary, '_id' | 'name'>
  view: ProjectRouteView
  id: string
}): string {
  return `/app/projects?view=${view}&id=${encodeURIComponent(id)}&projectId=${encodeURIComponent(project._id)}&projectName=${encodeURIComponent(project.name)}`
}

export function projectRouteViewForFile(file: Pick<ProjectFileSummary, 'kind' | 'extension' | 'mimeType' | 'name'>): 'note' | 'file' {
  return opensInDocumentEditor(file) ? 'note' : 'file'
}

export function sortProjectsByName<T extends Pick<ProjectSummary, 'name' | 'updatedAt'>>(projects: readonly T[]): T[] {
  return [...projects].sort((a, b) => {
    const byName = a.name.localeCompare(b.name)
    return byName !== 0 ? byName : b.updatedAt - a.updatedAt
  })
}

export function rootProjects<T extends Pick<ProjectSummary, 'parentId' | 'name' | 'updatedAt'>>(
  projects: readonly T[],
): T[] {
  return sortProjectsByName(projects.filter((project) => (project.parentId ?? null) === null))
}

export function childProjects<T extends Pick<ProjectSummary, '_id' | 'parentId' | 'name' | 'updatedAt'>>(
  projects: readonly T[],
  projectId: string,
): T[] {
  return sortProjectsByName(projects.filter((project) => project.parentId === projectId))
}

export function sortProjectFilesForTree<T extends Pick<ProjectFileSummary, 'type' | 'name'>>(files: readonly T[]): T[] {
  return [...files].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export function rootProjectFiles<T extends Pick<ProjectFileSummary, 'parentId' | 'type' | 'name'>>(
  files: readonly T[],
): T[] {
  return sortProjectFilesForTree(files.filter((file) => file.parentId == null))
}

export function childProjectFiles<T extends Pick<ProjectFileSummary, 'parentId' | 'type' | 'name'>>(
  files: readonly T[],
  parentId: string,
): T[] {
  return sortProjectFilesForTree(files.filter((file) => file.parentId === parentId))
}

export function projectFilesExcludingNotes<T extends Pick<ProjectFileSummary, 'kind'>>(files: readonly T[]): T[] {
  return files.filter((file) => file.kind !== 'note')
}

export function filterProjectFilesForSearch<T extends Pick<ProjectFileSummary, '_id' | 'name' | 'parentId'>>(
  files: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...files]
  const keep = new Set<string>()
  for (const file of files) {
    if (file.name.toLowerCase().includes(q)) {
      keep.add(file._id)
      let parentId = file.parentId
      while (parentId) {
        keep.add(parentId)
        parentId = files.find((candidate) => candidate._id === parentId)?.parentId ?? null
      }
    }
  }
  return files.filter((file) => keep.has(file._id))
}

export function canMoveProjectFile(
  files: readonly Pick<ProjectFileSummary, '_id' | 'parentId'>[],
  fileId: string,
  parentId: string | null,
): boolean {
  return canMoveKnowledgeFile(files, fileId, parentId)
}

export function projectNotesFromFiles<T extends Pick<ProjectFileSummary, '_id' | 'name' | 'updatedAt'>>(
  files: readonly T[],
): ProjectNoteSummary[] {
  return files.map((note) => ({ _id: note._id, title: note.name || 'Untitled', updatedAt: note.updatedAt ?? 0 }))
}

export function sortProjectChats<T extends ProjectChatSummary>(chats: readonly T[]): T[] {
  return [...chats].sort((a, b) => (b.updatedAt ?? b.lastModified ?? 0) - (a.updatedAt ?? a.lastModified ?? 0))
}

export function sortProjectFilesByUpdated<T extends Pick<ProjectFileSummary, 'updatedAt'>>(files: readonly T[]): T[] {
  return [...files].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

export function updateProjectInList<T extends ProjectSummary>(projects: readonly T[], project: T): T[] {
  return projects.map((candidate) => (candidate._id === project._id ? project : candidate))
}

export function renameProjectInList<T extends Pick<ProjectSummary, '_id' | 'name'>>(
  projects: readonly T[],
  projectId: string,
  name: string,
): T[] {
  return projects.map((project) => (project._id === projectId ? { ...project, name } : project))
}

export function removeProjectFromList<T extends Pick<ProjectSummary, '_id'>>(
  projects: readonly T[],
  projectId: string,
): T[] {
  return projects.filter((project) => project._id !== projectId)
}

export function removeProjectItemFromResources(
  items: ProjectResourceItems,
  type: 'chat' | 'note' | 'file',
  id: string,
): ProjectResourceItems {
  return {
    chats: type === 'chat' ? items.chats.filter((chat) => chat._id !== id) : items.chats,
    notes: type === 'note' ? items.notes.filter((note) => note._id !== id) : items.notes,
    files: type === 'file' ? items.files.filter((file) => file._id !== id) : items.files,
  }
}

export function projectFileTypeFromName(filename: string): ProjectUploadFileType {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (['md', 'markdown'].includes(ext)) return 'markdown'
  if (['txt', 'log', 'sh', 'py', 'js', 'ts', 'tsx', 'jsx', 'json', 'html', 'css', 'xml', 'yaml', 'yml', 'toml', 'go', 'rs', 'java', 'c', 'cpp', 'h'].includes(ext)) return 'text'
  if (ext === 'csv') return 'csv'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext)) return 'image'
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) return 'audio'
  if (['mp4', 'mov', 'mkv', 'webm', 'avi', 'ogv', 'm4v'].includes(ext)) return 'video'
  if (ext === 'pdf') return 'pdf'
  if (['docx', 'doc'].includes(ext)) return 'document'
  return 'binary'
}

export function shouldIngestProjectDocument(file: Pick<File, 'name' | 'type'>): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return (
    ext === 'pdf' ||
    ext === 'docx' ||
    file.type === 'application/pdf' ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
}

export function shouldUseProjectStorageUpload(file: Pick<File, 'name'>): boolean {
  const kind = projectFileTypeFromName(file.name)
  return kind === 'image' || kind === 'video' || kind === 'audio'
}

export function createProjectFolderRequest({
  name,
  parentId,
  projectId,
}: {
  name: string
  parentId: string | null
  projectId: string
}): CreateFileRequest {
  return {
    name,
    type: 'folder',
    parentId,
    projectId,
  }
}

export function createProjectNoteRequest(projectId: string): CreateFileRequest {
  return {
    kind: 'note',
    name: 'Untitled',
    textContent: '',
    projectId,
  }
}

export function createProjectStoredFileRequest({
  file,
  parentId,
  projectId,
  r2Key,
}: {
  file: Pick<File, 'name' | 'size'>
  parentId: string | null
  projectId: string
  r2Key: string
}): CreateFileRequest {
  return {
    name: file.name,
    type: 'file',
    parentId,
    r2Key,
    sizeBytes: file.size,
    projectId,
  }
}

export function createProjectTextFileRequest({
  file,
  parentId,
  projectId,
  content,
}: {
  file: Pick<File, 'name'>
  parentId: string | null
  projectId: string
  content: string
}): CreateFileRequest {
  return {
    name: file.name,
    type: 'file',
    parentId,
    content,
    projectId,
  }
}

export function conversationsToProjectChats(conversations: readonly ConversationSummary[]): ProjectChatSummary[] {
  return conversations.map((conversation) => ({
    _id: conversation._id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    lastModified: conversation.lastModified,
  }))
}
