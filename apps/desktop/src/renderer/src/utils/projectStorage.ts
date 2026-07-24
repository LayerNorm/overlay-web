import {
  createChatFolder,
  deleteChatFolder,
  loadChatFolders,
  saveChatFolders,
  updateChatFolder,
} from './folderStorage'

const PROJECTS_KEY = 'overlay-projects'
const PROJECTS_MIGRATED_KEY = 'overlay-projects-migrated-to-chat-folders-v1'
export const PROJECTS_CHANGED_EVENT = 'overlay:projects-changed'

export interface Project {
  id: string
  name: string
  parentId: string | null
  instructions?: string
  createdAt: number
  updatedAt: number
}

function emitProjectsChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PROJECTS_CHANGED_EVENT))
}

function mapFolderToProject(folder: {
  id: string
  name: string
  parentId: string | null
  instructions: string
  createdAt: number
  updatedAt: number
}): Project {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    instructions: folder.instructions || undefined,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  }
}

function migrateLegacyProjectsIfNeeded(): void {
  if (typeof localStorage === 'undefined') return
  if (localStorage.getItem(PROJECTS_MIGRATED_KEY) === 'true') return

  try {
    const data = localStorage.getItem(PROJECTS_KEY)
    if (!data) {
      localStorage.setItem(PROJECTS_MIGRATED_KEY, 'true')
      return
    }

    const legacyProjects = JSON.parse(data) as Array<{
      id: string
      name: string
      parentId: string | null
      createdAt: number
      updatedAt: number
    }>
    const existing = new Set(loadChatFolders().map((folder) => folder.id))

    for (const project of legacyProjects) {
      if (existing.has(project.id)) continue
      const folders = loadChatFolders()
      folders.push({
        id: project.id,
        name: project.name,
        parentId: project.parentId ?? null,
        instructions: '',
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        isExpanded: true,
      })
      saveChatFolders(folders)
    }

    localStorage.removeItem(PROJECTS_KEY)
    localStorage.setItem(PROJECTS_MIGRATED_KEY, 'true')
    emitProjectsChanged()
  } catch {
    localStorage.setItem(PROJECTS_MIGRATED_KEY, 'true')
  }
}

export function loadProjects(): Project[] {
  migrateLegacyProjectsIfNeeded()
  return loadChatFolders()
    .filter((folder) => !folder.isSkillsFolder)
    .map(mapFolderToProject)
}

export function createProject(name: string, parentId: string | null = null): Project {
  migrateLegacyProjectsIfNeeded()
  const folder = createChatFolder(name, parentId, '')
  emitProjectsChanged()
  return mapFolderToProject(folder)
}

export function updateProject(id: string, name: string, instructions?: string): void {
  migrateLegacyProjectsIfNeeded()
  updateChatFolder(id, {
    name,
    ...(instructions !== undefined ? { instructions } : {}),
  })
  emitProjectsChanged()
}

export function upsertProjectReplica(project: Project): void {
  migrateLegacyProjectsIfNeeded()
  const folders = loadChatFolders()
  const existingIndex = folders.findIndex((folder) => folder.id === project.id)
  if (existingIndex >= 0) {
    const existing = folders[existingIndex]
    folders[existingIndex] = {
      ...existing,
      name: project.name,
      parentId: project.parentId,
      instructions: project.instructions ?? existing.instructions ?? '',
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    }
    saveChatFolders(folders)
  } else {
    folders.push({
      id: project.id,
      name: project.name,
      parentId: project.parentId,
      instructions: project.instructions ?? '',
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      isExpanded: true,
    })
    saveChatFolders(folders)
  }
  emitProjectsChanged()
}

export function deleteProject(id: string): void {
  migrateLegacyProjectsIfNeeded()
  deleteChatFolder(id)
  emitProjectsChanged()
}
