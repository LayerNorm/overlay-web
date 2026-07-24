import { ipcMain } from '../services/security/secure-ipc-main'

import { chatService } from '../services/chat-service'
import { windowManager } from '../services/window-manager'
import { panelManager } from '../services/panel-manager'

let chatModelsCache: ReturnType<typeof chatService.getAvailableModels> | null = null
let chatModelsCacheTime = 0
const CHAT_MODELS_CACHE_TTL = 60_000

export async function invalidateChatModelsCache(): Promise<void> {
  chatModelsCache = null
  chatModelsCacheTime = 0
  await chatService.refreshProvidersAsync()
}

function sendTextToChatWindow(channel: 'chat:input-text' | 'chat:new-with-text', text: string) {
  const existingPanel = windowManager.findWindowByType('chat')

  if (existingPanel) {
    existingPanel.webContents.send(channel, text)
    existingPanel.focus()
    return { success: true }
  }

  panelManager.createPanelWindow('chat')

  return new Promise((resolve) => {
    const checkPanel = setInterval(() => {
      const panel = windowManager.findWindowByType('chat')
      if (!panel) return

      clearInterval(checkPanel)
      const send = () => {
        panel.webContents.send(channel, text)
        panel.focus()
        resolve({ success: true })
      }

      panel.webContents.once('did-finish-load', () => {
        setTimeout(send, 150)
      })
      if (!panel.webContents.isLoading()) {
        setTimeout(send, 150)
      }
    }, 50)

    setTimeout(() => {
      clearInterval(checkPanel)
      resolve({ success: false, error: 'Timeout waiting for chat panel' })
    }, 3000)
  })
}

export function registerChatIPC(): void {
  chatService.initialize()

  ipcMain.handle('chat:get-models', async () => {
    const now = Date.now()
    if (chatModelsCache && now - chatModelsCacheTime < CHAT_MODELS_CACHE_TTL) {
      return chatModelsCache
    }
    chatModelsCache = await chatService.getAvailableModelsAsync()
    chatModelsCacheTime = now
    return chatModelsCache
  })

  ipcMain.handle('chat:send-text-to-input', async (_evt, text: string) => {
    return sendTextToChatWindow('chat:input-text', text)
  })

  ipcMain.handle('chat:send-text-to-new', async (_evt, text: string) => {
    return sendTextToChatWindow('chat:new-with-text', text)
  })
}
