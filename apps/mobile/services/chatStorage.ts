import AsyncStorage from '@react-native-async-storage/async-storage'
import { Chat, ChatMeta, Message, generateChatId } from './chatTypes'

const CHATS_META_KEY = 'overlay-chats-meta'
const CHAT_PREFIX = 'overlay-chat-'
const LAST_CHAT_ID_KEY = 'overlay-last-chat-id'

export async function loadChatsMeta(): Promise<ChatMeta[]> {
  try {
    const data = await AsyncStorage.getItem(CHATS_META_KEY)
    if (!data) return []
    const metas: ChatMeta[] = JSON.parse(data)
    return metas.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

async function saveChatsMeta(metas: ChatMeta[]): Promise<void> {
  await AsyncStorage.setItem(CHATS_META_KEY, JSON.stringify(metas))
}

export async function saveChat(chat: Chat): Promise<void> {
  await AsyncStorage.setItem(`${CHAT_PREFIX}${chat.id}`, JSON.stringify(chat))

  const metas = await loadChatsMeta()
  const existingIndex = metas.findIndex((m) => m.id === chat.id)

  const lastMsg = chat.messages.length > 0
    ? chat.messages[chat.messages.length - 1].content
    : undefined

  const meta: ChatMeta = {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    lastMessage: lastMsg ? (lastMsg.length > 80 ? lastMsg.slice(0, 80) + '...' : lastMsg) : undefined,
    folderId: chat.folderId
  }

  if (existingIndex >= 0) {
    metas[existingIndex] = meta
  } else {
    metas.unshift(meta)
  }

  await saveChatsMeta(metas)
}

export async function loadChat(id: string): Promise<Chat | null> {
  try {
    const data = await AsyncStorage.getItem(`${CHAT_PREFIX}${id}`)
    if (!data) return null
    return JSON.parse(data)
  } catch {
    return null
  }
}

export async function deleteChat(id: string): Promise<void> {
  await AsyncStorage.removeItem(`${CHAT_PREFIX}${id}`)

  const metas = await loadChatsMeta()
  const filtered = metas.filter((m) => m.id !== id)
  await saveChatsMeta(filtered)

  const lastId = await getLastOpenedChatId()
  if (lastId === id) {
    await AsyncStorage.removeItem(LAST_CHAT_ID_KEY)
  }
}

export async function getLastOpenedChatId(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_CHAT_ID_KEY)
}

export async function setLastOpenedChatId(id: string): Promise<void> {
  await AsyncStorage.setItem(LAST_CHAT_ID_KEY, id)
}

export async function updateChatTitle(id: string, title: string): Promise<void> {
  const chat = await loadChat(id)
  if (chat) {
    chat.title = title
    chat.updatedAt = Date.now()
    await saveChat(chat)
  }
}

export async function updateChatMessages(id: string, messages: Message[]): Promise<void> {
  const chat = await loadChat(id)
  if (chat) {
    chat.messages = messages
    chat.updatedAt = Date.now()
    await saveChat(chat)
  }
}

export async function createNewChat(modelId?: string): Promise<Chat> {
  const id = generateChatId()
  const now = Date.now()
  const chat: Chat = {
    id,
    title: 'New Chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
    modelId
  }
  await saveChat(chat)
  await setLastOpenedChatId(id)
  return chat
}
