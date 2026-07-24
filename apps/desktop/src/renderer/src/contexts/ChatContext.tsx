/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  CHATS_CHANGED_EVENT,
  appendOrReplaceMessage as appendOrReplaceStoredMessage,
  createNewChat as createStoredNewChat,
  deleteChat as deleteStoredChat,
  deleteTurn as deleteStoredTurn,
  getChat as getStoredChat,
  getLastOpenedChatId as getStoredLastOpenedChatId,
  listChatsMeta,
  loadChat as loadStoredChat,
  loadChatsMeta,
  saveChat as saveStoredChat,
  setLastOpenedChatId as setStoredLastOpenedChatId,
  updateChatTitle as updateStoredChatTitle
} from '../utils/chatStorage'
import type { Chat, ChatMeta, Message } from '../components/chat'
import { getAuthReadyState } from '../services/auth-service'

interface ChatContextValue {
  conversations: ChatMeta[] | undefined
  currentChat: Chat | null | undefined
  isLoading: boolean
  error: string | null
  loadChatsMeta: () => ChatMeta[]
  listChatsMeta: () => Promise<ChatMeta[]>
  loadChat: (id: string) => Chat | null
  getChat: (id: string) => Promise<Chat | null>
  createNewChat: (modelId?: string, folderId?: string, isAgent?: boolean) => Promise<Chat>
  saveChat: (chat: Chat) => Promise<void>
  deleteChat: (id: string) => Promise<boolean>
  updateChatTitle: (id: string, title: string) => Promise<void>
  appendOrReplaceMessage: (chatId: string, message: Message) => Promise<void>
  deleteTurn: (chatId: string, turnId: string) => Promise<void>
  getLastOpenedChatId: () => string | null
  setLastOpenedChatId: (id: string) => void
  setCurrentChatId: (id: string | null) => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

export function useChatContext(): ChatContextValue {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useChatContext must be used within ChatProvider')
  }
  return context
}

export function ChatProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [conversations, setConversations] = useState<ChatMeta[]>(() => loadChatsMeta())
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const [currentChat, setCurrentChat] = useState<Chat | null | undefined>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshConversations = useCallback(async (): Promise<ChatMeta[]> => {
    if (getAuthReadyState() !== true) return []
    if (loadChatsMeta().length === 0) setIsLoading(true)
    try {
      const chats = await listChatsMeta()
      setConversations(chats)
      setError(null)
      return chats
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load chats'
      setError(message)
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const refreshWhenAuthenticated = (event: Event): void => {
      const authed = (event as CustomEvent<{ authed?: boolean }>).detail?.authed === true
      if (!authed) return
      void refreshConversations().catch((error) => {
        console.error('[ChatContext] Failed to load conversations:', error)
      })
    }
    window.addEventListener('overlay:auth-ready', refreshWhenAuthenticated)
    if (getAuthReadyState() === true) {
      void refreshConversations().catch((error) => {
        console.error('[ChatContext] Failed to load conversations:', error)
      })
    }
    return () => {
      window.removeEventListener('overlay:auth-ready', refreshWhenAuthenticated)
    }
  }, [refreshConversations])

  useEffect(() => {
    if (!error) return
    const retry = window.setTimeout(() => {
      void refreshConversations().catch((err) => {
        console.error('[ChatContext] Failed to retry conversations:', err)
      })
    }, 2500)
    return () => window.clearTimeout(retry)
  }, [error, refreshConversations])

  useEffect(() => {
    const refresh = (): void => {
      void refreshConversations().catch((err) => {
        console.error('[ChatContext] Failed to refresh conversations:', err)
      })
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [refreshConversations])

  useEffect(() => {
    const handler = (): void => {
      setConversations(loadChatsMeta())
      if (currentChatId) {
        const cached = loadStoredChat(currentChatId)
        if (cached) setCurrentChat(cached)
      }
    }
    window.addEventListener(CHATS_CHANGED_EVENT, handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener(CHATS_CHANGED_EVENT, handler)
      window.removeEventListener('storage', handler)
    }
  }, [currentChatId])

  const contextLoadChatsMeta = useCallback((): ChatMeta[] => loadChatsMeta(), [])

  const contextListChatsMeta = useCallback(async (): Promise<ChatMeta[]> => {
    return refreshConversations()
  }, [refreshConversations])

  const loadChat = useCallback((id: string): Chat | null => {
    setCurrentChatId(id)
    const chat = loadStoredChat(id)
    setCurrentChat(chat)
    return chat
  }, [])

  const getChat = useCallback(async (id: string): Promise<Chat | null> => {
    setCurrentChatId(id)
    const chat = await getStoredChat(id)
    setCurrentChat(chat)
    return chat
  }, [])

  const createNewChat = useCallback(
    async (modelId?: string, folderId?: string, isAgent?: boolean): Promise<Chat> => {
      const chat = await createStoredNewChat(modelId, folderId, isAgent)
      setCurrentChatId(chat.id)
      setCurrentChat(chat)
      setConversations(loadChatsMeta())
      return chat
    },
    []
  )

  const saveChat = useCallback(async (chat: Chat): Promise<void> => {
    await saveStoredChat(chat)
    setCurrentChat(chat)
    setConversations(loadChatsMeta())
  }, [])

  const deleteChat = useCallback(
    async (id: string): Promise<boolean> => {
      const deleted = await deleteStoredChat(id)
      if (currentChatId === id) {
        setCurrentChatId(null)
        setCurrentChat(null)
      }
      setConversations(loadChatsMeta())
      return deleted
    },
    [currentChatId]
  )

  const updateChatTitle = useCallback(async (id: string, title: string): Promise<void> => {
    await updateStoredChatTitle(id, title)
    setConversations(loadChatsMeta())
    setCurrentChat((chat) => (chat?.id === id ? { ...chat, title, updatedAt: Date.now() } : chat))
  }, [])

  const appendOrReplaceMessage = useCallback(
    async (chatId: string, message: Message): Promise<void> => {
      await appendOrReplaceStoredMessage(chatId, message)
      setConversations(loadChatsMeta())
    },
    []
  )

  const deleteTurn = useCallback(
    async (chatId: string, turnId: string): Promise<void> => {
      await deleteStoredTurn(chatId, turnId)
      if (currentChatId === chatId) {
        const chat = await getStoredChat(chatId)
        setCurrentChat(chat)
      }
    },
    [currentChatId]
  )

  const setLastOpenedChatId = useCallback((id: string): void => {
    setStoredLastOpenedChatId(id)
  }, [])

  const value = useMemo<ChatContextValue>(
    () => ({
      conversations,
      currentChat,
      isLoading,
      error,
      loadChatsMeta: contextLoadChatsMeta,
      listChatsMeta: contextListChatsMeta,
      loadChat,
      getChat,
      createNewChat,
      saveChat,
      deleteChat,
      updateChatTitle,
      appendOrReplaceMessage,
      deleteTurn,
      getLastOpenedChatId: getStoredLastOpenedChatId,
      setLastOpenedChatId,
      setCurrentChatId
    }),
    [
      appendOrReplaceMessage,
      contextListChatsMeta,
      contextLoadChatsMeta,
      conversations,
      createNewChat,
      currentChat,
      deleteChat,
      deleteTurn,
      error,
      getChat,
      isLoading,
      loadChat,
      saveChat,
      setLastOpenedChatId,
      updateChatTitle
    ]
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}
