import { createContext, useContext } from 'react'

/**
 * Runtime configuration for @overlay/chat-react components.
 *
 * Consumers (web app, desktop renderer) can wrap their tree in
 * {@link ChatReactConfigContext.Provider} to override defaults like the
 * tool-call logo URL. When no provider is present, components fall back to
 * the web-app defaults (e.g. `/overlay-logo.png`).
 */
export interface ChatReactConfig {
  /**
   * URL for the overlay mark rendered in tool-call rails.
   * Defaults to `/overlay-logo.png` (web app public asset).
   */
  toolLogoUrl?: string
}

export const ChatReactConfigContext = createContext<ChatReactConfig>({})

export function useChatReactConfig(): ChatReactConfig {
  return useContext(ChatReactConfigContext)
}
