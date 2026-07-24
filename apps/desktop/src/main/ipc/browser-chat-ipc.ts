import { ipcMain } from '../services/security/secure-ipc-main'

import {
  browserChatSessionService,
  type BrowserChatSession
} from '../services/browser-chat-session-service'

export function registerBrowserChatIPC(): void {
  // Load all sessions
  ipcMain.handle('browser-chat:list-sessions', () => {
    return browserChatSessionService.listSessions()
  })

  // Get a specific session
  ipcMain.handle('browser-chat:get-session', (_event, sessionId: string) => {
    return browserChatSessionService.getSession(sessionId)
  })

  // Create a new session
  ipcMain.handle('browser-chat:create-session', (_event, mode: 'ask' | 'act') => {
    return browserChatSessionService.createSession(mode)
  })

  // Update a session
  ipcMain.handle(
    'browser-chat:update-session',
    (
      _event,
      sessionId: string,
      updates: Partial<Pick<BrowserChatSession, 'title' | 'messages' | 'mode'>>
    ) => {
      return browserChatSessionService.updateSession(sessionId, updates)
    }
  )

  // Delete a session
  ipcMain.handle('browser-chat:delete-session', (_event, sessionId: string) => {
    return browserChatSessionService.deleteSession(sessionId)
  })

  // Clear all sessions
  ipcMain.handle('browser-chat:clear-sessions', () => {
    browserChatSessionService.clearAllSessions()
    return true
  })

  // Initialize by loading sessions
  browserChatSessionService.loadSessions()
}
