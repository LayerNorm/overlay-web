export interface NoteMeta {
  id: string
  title: string
  updatedAt: number
  createdAt: number
  folderId: string | null
  isLocked?: boolean
}

export interface Note extends NoteMeta {
  content: string
}

export interface Folder {
  id: string
  name: string
  parentId: string | null
  createdAt: number
  updatedAt: number
  isExpanded: boolean
}

export function generateNoteId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export function generateFolderId(): string {
  return `folder-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function getDateLabel(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) {
    return 'TODAY'
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'YESTERDAY'
  } else {
    return date
      .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      .toUpperCase()
  }
}
