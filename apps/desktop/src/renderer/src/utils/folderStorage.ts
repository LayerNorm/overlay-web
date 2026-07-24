// Folder storage utilities for chats and notes

export interface Folder {
  id: string
  name: string
  parentId: string | null // null means root level
  instructions: string // Project-specific system prompt
  color?: string // Optional color coding
  createdAt: number
  updatedAt: number
  isExpanded: boolean
  isSkillsFolder?: boolean // Special skills folder that cannot be deleted
}

// Fixed ID for the skills folder
export const SKILLS_FOLDER_ID = 'skills-folder-system'
export const SKILLS_FOLDER_NAME = 'Skills'
export const SKILLS_FOLDER_COLOR = '#8b5cf6' // Purple color for skills folder

export interface FolderMeta {
  id: string
  name: string
  parentId: string | null
  isExpanded: boolean
}

const CHAT_FOLDERS_KEY = 'overlay-chat-folders'
const NOTE_FOLDERS_KEY = 'overlay-note-folders'
const CHAT_FOLDER_MAP_KEY = 'overlay-chat-folder-map' // Maps chatId -> folderId
const NOTE_FOLDER_MAP_KEY = 'overlay-note-folder-map' // Maps noteId -> folderId

// ============== Chat Folders ==============

export function generateFolderId(): string {
  return `folder-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export function loadChatFolders(): Folder[] {
  try {
    const data = localStorage.getItem(CHAT_FOLDERS_KEY)
    if (!data) return []
    return JSON.parse(data)
  } catch {
    return []
  }
}

export function saveChatFolders(folders: Folder[]): void {
  localStorage.setItem(CHAT_FOLDERS_KEY, JSON.stringify(folders))
}

export function createChatFolder(
  name: string,
  parentId: string | null = null,
  instructions = ''
): Folder {
  const now = Date.now()
  const folder: Folder = {
    id: generateFolderId(),
    name,
    parentId,
    instructions,
    createdAt: now,
    updatedAt: now,
    isExpanded: true
  }
  const folders = loadChatFolders()
  folders.push(folder)
  saveChatFolders(folders)
  return folder
}

export function updateChatFolder(
  id: string,
  updates: Partial<Omit<Folder, 'id' | 'createdAt'>>
): void {
  const folders = loadChatFolders()
  const idx = folders.findIndex((f) => f.id === id)
  if (idx >= 0) {
    folders[idx] = { ...folders[idx], ...updates, updatedAt: Date.now() }
    saveChatFolders(folders)
  }
}

export function deleteChatFolder(id: string): void {
  const folders = loadChatFolders()
  // Get all descendant folder IDs
  const getDescendants = (parentId: string): string[] => {
    const children = folders.filter((f) => f.parentId === parentId)
    return children.flatMap((c) => [c.id, ...getDescendants(c.id)])
  }
  const toDelete = new Set([id, ...getDescendants(id)])

  // Remove folders
  const remaining = folders.filter((f) => !toDelete.has(f.id))
  saveChatFolders(remaining)

  // Move items in deleted folders to root
  const map = loadChatFolderMap()
  const newMap: Record<string, string> = {}
  for (const [chatId, folderId] of Object.entries(map)) {
    if (!toDelete.has(folderId)) {
      newMap[chatId] = folderId
    }
  }
  saveChatFolderMap(newMap)
}

export function loadChatFolderMap(): Record<string, string> {
  try {
    const data = localStorage.getItem(CHAT_FOLDER_MAP_KEY)
    if (!data) return {}
    return JSON.parse(data)
  } catch {
    return {}
  }
}

export function saveChatFolderMap(map: Record<string, string>): void {
  localStorage.setItem(CHAT_FOLDER_MAP_KEY, JSON.stringify(map))
}

export function moveChatToFolder(chatId: string, folderId: string | null): void {
  const map = loadChatFolderMap()
  if (folderId === null) {
    delete map[chatId]
  } else {
    map[chatId] = folderId
  }
  saveChatFolderMap(map)
}

export function getChatFolderId(chatId: string): string | null {
  const map = loadChatFolderMap()
  return map[chatId] || null
}

export function toggleChatFolderExpanded(folderId: string): void {
  const folders = loadChatFolders()
  const idx = folders.findIndex((f) => f.id === folderId)
  if (idx >= 0) {
    folders[idx].isExpanded = !folders[idx].isExpanded
    saveChatFolders(folders)
  }
}

export function moveChatFolderToFolder(folderId: string, targetFolderId: string | null): boolean {
  const folders = loadChatFolders()
  const idx = folders.findIndex((f) => f.id === folderId)
  if (idx < 0) return false

  // Prevent moving a folder into itself or its descendants
  if (targetFolderId !== null) {
    const getDescendants = (parentId: string): string[] => {
      const children = folders.filter((f) => f.parentId === parentId)
      return children.flatMap((c) => [c.id, ...getDescendants(c.id)])
    }
    const descendants = getDescendants(folderId)
    if (targetFolderId === folderId || descendants.includes(targetFolderId)) {
      return false
    }
  }

  folders[idx].parentId = targetFolderId
  folders[idx].updatedAt = Date.now()
  saveChatFolders(folders)
  return true
}

// ============== Note Folders ==============

export function loadNoteFolders(): Folder[] {
  try {
    const data = localStorage.getItem(NOTE_FOLDERS_KEY)
    if (!data) return []
    return JSON.parse(data)
  } catch {
    return []
  }
}

export function saveNoteFolders(folders: Folder[]): void {
  localStorage.setItem(NOTE_FOLDERS_KEY, JSON.stringify(folders))
}

export function createNoteFolder(
  name: string,
  parentId: string | null = null,
  instructions = ''
): Folder {
  const now = Date.now()
  const folder: Folder = {
    id: generateFolderId(),
    name,
    parentId,
    instructions,
    createdAt: now,
    updatedAt: now,
    isExpanded: true
  }
  const folders = loadNoteFolders()
  folders.push(folder)
  saveNoteFolders(folders)
  return folder
}

export function updateNoteFolder(
  id: string,
  updates: Partial<Omit<Folder, 'id' | 'createdAt'>>
): void {
  const folders = loadNoteFolders()
  const idx = folders.findIndex((f) => f.id === id)
  if (idx >= 0) {
    folders[idx] = { ...folders[idx], ...updates, updatedAt: Date.now() }
    saveNoteFolders(folders)
  }
}

export function deleteNoteFolder(id: string): void {
  // Protect skills folder from deletion
  if (id === SKILLS_FOLDER_ID) {
    console.warn('[FolderStorage] Cannot delete the Skills folder')
    return
  }

  const folders = loadNoteFolders()
  // Get all descendant folder IDs
  const getDescendants = (parentId: string): string[] => {
    const children = folders.filter((f) => f.parentId === parentId)
    return children.flatMap((c) => [c.id, ...getDescendants(c.id)])
  }
  const toDelete = new Set([id, ...getDescendants(id)])

  // Remove folders
  const remaining = folders.filter((f) => !toDelete.has(f.id))
  saveNoteFolders(remaining)

  // Move items in deleted folders to root
  const map = loadNoteFolderMap()
  const newMap: Record<string, string> = {}
  for (const [noteId, folderId] of Object.entries(map)) {
    if (!toDelete.has(folderId)) {
      newMap[noteId] = folderId
    }
  }
  saveNoteFolderMap(newMap)
}

// Ensure the Skills folder exists
export function ensureSkillsFolder(): Folder {
  const folders = loadNoteFolders()
  const existing = folders.find((f) => f.id === SKILLS_FOLDER_ID)
  if (existing) return existing

  const now = Date.now()
  const skillsFolder: Folder = {
    id: SKILLS_FOLDER_ID,
    name: SKILLS_FOLDER_NAME,
    parentId: null,
    instructions: 'Agent skills stored as markdown notes',
    color: SKILLS_FOLDER_COLOR,
    createdAt: now,
    updatedAt: now,
    isExpanded: true,
    isSkillsFolder: true
  }
  folders.unshift(skillsFolder) // Add at beginning
  saveNoteFolders(folders)
  return skillsFolder
}

// Get all skills (notes in the Skills folder)
export function getSkillNoteIds(): string[] {
  const map = loadNoteFolderMap()
  return Object.entries(map)
    .filter(([, folderId]) => folderId === SKILLS_FOLDER_ID)
    .map(([noteId]) => noteId)
}

// Check if a folder is the skills folder
export function isSkillsFolder(folderId: string): boolean {
  return folderId === SKILLS_FOLDER_ID
}

export function loadNoteFolderMap(): Record<string, string> {
  try {
    const data = localStorage.getItem(NOTE_FOLDER_MAP_KEY)
    if (!data) return {}
    return JSON.parse(data)
  } catch {
    return {}
  }
}

export function saveNoteFolderMap(map: Record<string, string>): void {
  localStorage.setItem(NOTE_FOLDER_MAP_KEY, JSON.stringify(map))
}

export function moveNoteToFolder(noteId: string, folderId: string | null): void {
  const map = loadNoteFolderMap()
  if (folderId === null) {
    delete map[noteId]
  } else {
    map[noteId] = folderId
  }
  saveNoteFolderMap(map)
}

export function getNoteFolderId(noteId: string): string | null {
  const map = loadNoteFolderMap()
  return map[noteId] || null
}

export function toggleNoteFolderExpanded(folderId: string): void {
  const folders = loadNoteFolders()
  const idx = folders.findIndex((f) => f.id === folderId)
  if (idx >= 0) {
    folders[idx].isExpanded = !folders[idx].isExpanded
    saveNoteFolders(folders)
  }
}

export function moveNoteFolderToFolder(folderId: string, targetFolderId: string | null): boolean {
  const folders = loadNoteFolders()
  const idx = folders.findIndex((f) => f.id === folderId)
  if (idx < 0) return false

  // Prevent moving a folder into itself or its descendants
  if (targetFolderId !== null) {
    const getDescendants = (parentId: string): string[] => {
      const children = folders.filter((f) => f.parentId === parentId)
      return children.flatMap((c) => [c.id, ...getDescendants(c.id)])
    }
    const descendants = getDescendants(folderId)
    if (targetFolderId === folderId || descendants.includes(targetFolderId)) {
      return false
    }
  }

  folders[idx].parentId = targetFolderId
  folders[idx].updatedAt = Date.now()
  saveNoteFolders(folders)
  return true
}

// ============== Skill Metadata ==============

export interface SkillMetadata {
  version: number
  status: 'draft' | 'active' | 'archived'
  triggers: string[]
  description: string
  scope: { global: boolean; folderIds: string[] }
  inputs: Array<{ name: string; description: string; required: boolean }>
  source: {
    kind: 'manual' | 'agent-run' | 'marketplace'
    chatId?: string
    messageId?: string
    runId?: string
  }
  executionMode: 'prompt-procedure' | 'tool-guided'
  enabled: boolean
  usageCount: number
  lastUsedAt: number
  previousVersions?: Array<{ content: string; updatedAt: number }>
}

export function createDefaultSkillMetadata(overrides?: Partial<SkillMetadata>): SkillMetadata {
  const now = Date.now()
  return {
    version: 1,
    status: 'active',
    triggers: [],
    description: '',
    scope: { global: true, folderIds: [] },
    inputs: [],
    source: { kind: 'manual' },
    executionMode: 'prompt-procedure',
    enabled: true,
    usageCount: 0,
    lastUsedAt: now,
    ...overrides
  }
}

// ============== Utility Functions ==============

export interface FolderTreeNode {
  folder: Folder
  children: FolderTreeNode[]
  items: { id: string; title: string; updatedAt: number }[]
}

export function buildFolderTree<T extends { id: string; title: string; updatedAt: number }>(
  folders: Folder[],
  items: T[],
  folderMap: Record<string, string>,
  parentId: string | null = null
): FolderTreeNode[] {
  const childFolders = folders.filter((f) => f.parentId === parentId)

  return childFolders.map((folder) => ({
    folder,
    children: buildFolderTree(folders, items, folderMap, folder.id),
    items: items.filter((item) => folderMap[item.id] === folder.id)
  }))
}

export function getRootItems<T extends { id: string }>(
  items: T[],
  folderMap: Record<string, string>
): T[] {
  return items.filter((item) => !folderMap[item.id])
}
