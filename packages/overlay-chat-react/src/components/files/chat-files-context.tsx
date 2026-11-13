import { createContext, useContext, type ReactNode } from 'react'

/** What a file card needs to know about an Overlay file: never its text or storage key. */
export type ChatFileSummary = {
  _id: string
  name: string
  kind?: string
  mimeType?: string
  previewText?: string
  createdAt?: number
  /** Changes on every save, so previews know to reload the file's text. */
  updatedAt?: number
}

export type ChatFileOpenRequest = { id: string; name?: string; kind?: string; mimeType?: string }

/**
 * The host's file access for chat cards and tool rows. `useFileSummaries` is a hook (the web app backs it with a live
 * Convex query), so a provider must keep the same implementation for its lifetime. `openFile` shows a file where the
 * surface keeps its files: the agent thread's Library panel, or the Files page elsewhere.
 */
export type ChatFilesHost = {
  useFileSummaries: (ids: readonly string[]) => ReadonlyMap<string, ChatFileSummary> | undefined
  openFile?: (file: ChatFileOpenRequest) => void
}

const noSummaries: ChatFilesHost['useFileSummaries'] = () => undefined
const fallbackHost: ChatFilesHost = { useFileSummaries: noSummaries }

const ChatFilesContext = createContext<ChatFilesHost>(fallbackHost)

export function ChatFilesProvider({ value, children }: { value: ChatFilesHost; children: ReactNode }) {
  return <ChatFilesContext.Provider value={value}>{children}</ChatFilesContext.Provider>
}

export function useChatFilesHost(): ChatFilesHost {
  return useContext(ChatFilesContext)
}

/** Overlay's file content route; the id is the `files` row id. */
export function fileContentUrl(fileId: string): string {
  return `/api/v1/files/${encodeURIComponent(fileId)}/content`
}

const FILE_CONTENT_PATH = /^\/api\/v1\/files\/([^/?#]+)\/content(?:[?#].*)?$/

/** The file id in an Overlay file content URL (relative, or absolute on any host), or null for other links. */
export function fileIdFromContentHref(href: string | undefined | null): string | null {
  if (!href) return null
  let path = href
  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href)
      path = `${url.pathname}${url.search}${url.hash}`
    } catch {
      return null
    }
  }
  const match = FILE_CONTENT_PATH.exec(path)
  if (!match) return null
  try {
    return decodeURIComponent(match[1]!)
  } catch {
    return null
  }
}

export type ChatFileKind = 'image' | 'video' | 'note' | 'file'

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i
const VIDEO_EXTENSION = /\.(mp4|webm|mov|m4v|ogv)$/i

export function chatFileKind(file: { kind?: string; mimeType?: string; name?: string }): ChatFileKind {
  if (file.kind === 'note') return 'note'
  if (file.mimeType?.startsWith('image/') || (!file.mimeType && file.name && IMAGE_EXTENSION.test(file.name))) return 'image'
  if (file.mimeType?.startsWith('video/') || (!file.mimeType && file.name && VIDEO_EXTENSION.test(file.name))) return 'video'
  return 'file'
}
