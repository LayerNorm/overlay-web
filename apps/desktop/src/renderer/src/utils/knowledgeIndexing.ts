import { loadChat } from './chatStorage'
import { getChatFolderId, getNoteFolderId } from './folderStorage'

type MentionLike = {
  id: string
  type: 'note' | 'chat' | 'document' | 'file'
  title: string
  folderId?: string
}

type ChatMessageLike = {
  role: string
  content: string
}

export async function indexNoteSnapshot(note: {
  id: string
  title: string
  content: string
  folderId?: string | null
  updatedAt?: number
}): Promise<void> {
  await window.bridge.knowledge.indexNote({
    id: note.id,
    title: note.title,
    content: note.content,
    folderId: note.folderId ?? undefined,
    updatedAt: note.updatedAt ?? Date.now()
  })
}

export async function indexNoteById(noteId: string, folderId?: string | null): Promise<void> {
  const note = await window.bridge.loadNote(noteId)
  if (!note) return

  await indexNoteSnapshot({
    id: note.id,
    title: note.title,
    content: note.content,
    folderId: folderId ?? getNoteFolderId(note.id),
    updatedAt: note.updatedAt
  })
}

export async function indexChatSnapshot(chat: {
  id: string
  title: string
  messages: ChatMessageLike[]
  folderId?: string | null
  createdAt?: number
  updatedAt?: number
}): Promise<void> {
  if (chat.messages.length === 0) return

  await window.bridge.knowledge.indexChat({
    id: chat.id,
    title: chat.title,
    messages: chat.messages,
    folderId: chat.folderId ?? undefined,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt ?? Date.now()
  })
}

export async function indexStoredChatById(chatId: string, folderId?: string | null): Promise<void> {
  const chat = loadChat(chatId)
  if (!chat) return

  await indexChatSnapshot({
    id: chat.id,
    title: chat.title,
    messages: chat.messages.map((message) => ({
      role: message.role,
      content: message.content
    })),
    folderId: folderId ?? getChatFolderId(chat.id),
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt
  })
}

export async function indexBrowserSessionSnapshot(session: {
  id: string
  title: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  createdAt?: number
  updatedAt?: number
}): Promise<void> {
  await indexChatSnapshot({
    id: session.id,
    title: session.title,
    messages: session.messages,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  })
}

export async function indexMentionReferences(mentions: MentionLike[]): Promise<void> {
  const jobs = mentions
    .filter((mention) => mention.type === 'note' || mention.type === 'chat')
    .map(async (mention) => {
      if (mention.type === 'note') {
        await indexNoteById(mention.id, mention.folderId)
        return
      }

      await indexStoredChatById(mention.id, mention.folderId)
    })

  const results = await Promise.allSettled(jobs)
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[KnowledgeIndexing] Failed to index explicit reference:', result.reason)
    }
  }
}

export function runInBackground(task: () => Promise<void>, label: string): void {
  void task().catch((error) => {
    console.error(`[KnowledgeIndexing] ${label}:`, error)
  })
}

export function runAfterUi(task: () => Promise<void>, label: string): void {
  window.setTimeout(() => {
    runInBackground(task, label)
  }, 0)
}
