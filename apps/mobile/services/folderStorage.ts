import AsyncStorage from '@react-native-async-storage/async-storage'
import { Folder, generateFolderId } from './types'

const NOTE_FOLDERS_KEY = 'overlay-note-folders'

export async function loadNoteFolders(): Promise<Folder[]> {
  try {
    const data = await AsyncStorage.getItem(NOTE_FOLDERS_KEY)
    if (!data) return []
    return JSON.parse(data)
  } catch {
    return []
  }
}

async function saveNoteFolders(folders: Folder[]): Promise<void> {
  await AsyncStorage.setItem(NOTE_FOLDERS_KEY, JSON.stringify(folders))
}

export async function createNoteFolder(
  name: string,
  parentId: string | null = null
): Promise<Folder> {
  const now = Date.now()
  const folder: Folder = {
    id: generateFolderId(),
    name,
    parentId,
    createdAt: now,
    updatedAt: now,
    isExpanded: true
  }
  const folders = await loadNoteFolders()
  folders.push(folder)
  await saveNoteFolders(folders)
  return folder
}

export async function updateNoteFolder(
  id: string,
  updates: Partial<Omit<Folder, 'id' | 'createdAt'>>
): Promise<void> {
  const folders = await loadNoteFolders()
  const idx = folders.findIndex((f) => f.id === id)
  if (idx >= 0) {
    folders[idx] = { ...folders[idx], ...updates, updatedAt: Date.now() }
    await saveNoteFolders(folders)
  }
}

export async function deleteNoteFolder(id: string): Promise<void> {
  const folders = await loadNoteFolders()

  const getDescendants = (parentId: string): string[] => {
    const children = folders.filter((f) => f.parentId === parentId)
    return children.flatMap((c) => [c.id, ...getDescendants(c.id)])
  }
  const toDelete = new Set([id, ...getDescendants(id)])

  const remaining = folders.filter((f) => !toDelete.has(f.id))
  await saveNoteFolders(remaining)
}

export async function toggleNoteFolderExpanded(folderId: string): Promise<void> {
  const folders = await loadNoteFolders()
  const idx = folders.findIndex((f) => f.id === folderId)
  if (idx >= 0) {
    folders[idx].isExpanded = !folders[idx].isExpanded
    await saveNoteFolders(folders)
  }
}
