import { ipcMain } from '../services/security/secure-ipc-main'

import {
  initiateOAuthFlow,
  checkConnectionStatus,
  disconnectToolkit,
  isToolkitConnected,
  getConnectedToolkits,
  syncConnectedToolkits,
  getToolkitMetadata,
  listToolkitPickerItems
} from '../services/agent/composio-service'

export function registerComposioIPC(): void {
  // Check if a toolkit is connected
  ipcMain.handle('composio:is-connected', async (_event, toolkit: string) => {
    await syncConnectedToolkits()
    return isToolkitConnected(toolkit)
  })

  // Get all connected toolkits
  ipcMain.handle('composio:get-connected', async () => {
    console.log('[ComposioIPC] composio:get-connected')
    await syncConnectedToolkits()
    return getConnectedToolkits()
  })

  // Get toolkit metadata (name, description, logo) for one or more toolkits
  ipcMain.handle('composio:get-toolkit-metadata', async (_event, toolkits: string[]) => {
    try {
      if (!Array.isArray(toolkits)) return {}
      console.log(
        `[ComposioIPC] composio:get-toolkit-metadata toolkits=${toolkits.length}`
      )
      return await getToolkitMetadata(toolkits)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[ComposioIPC] Failed to get toolkit metadata:', message)
      return {}
    }
  })

  // List available OAuth toolkits for integration picker with cursor pagination
  ipcMain.handle(
    'composio:list-toolkits',
    async (
      _event,
      args: { query?: string; cursor?: string; limit?: number } | undefined
    ) => {
      try {
        console.log(
          `[ComposioIPC] composio:list-toolkits query="${args?.query || ''}" cursor=${args?.cursor || 'null'} limit=${args?.limit || 5}`
        )
        return await listToolkitPickerItems({
          query: args?.query,
          cursor: args?.cursor,
          limit: args?.limit
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[ComposioIPC] Failed to list toolkits:', message)
        return { items: [], nextCursor: null }
      }
    }
  )

  // Initiate OAuth flow for a toolkit
  ipcMain.handle('composio:connect', async (_event, toolkit: string) => {
    try {
      console.log(`[ComposioIPC] composio:connect toolkit="${toolkit}"`)
      const { redirectUrl, connectionId, alreadyConnected } = await initiateOAuthFlow(toolkit)
      console.log(
        `[ComposioIPC] composio:connect success toolkit="${toolkit}" hasRedirect=${Boolean(redirectUrl)} alreadyConnected=${Boolean(alreadyConnected)} connectionId=${connectionId || 'none'}`
      )
      return { success: true, redirectUrl, connectionId, alreadyConnected }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[ComposioIPC] composio:connect failed toolkit="${toolkit}" error=${message}`)
      return { success: false, error: message }
    }
  })

  // Check connection status (after OAuth redirect)
  ipcMain.handle('composio:check-status', async (_event, toolkit: string) => {
    try {
      console.log(`[ComposioIPC] composio:check-status toolkit="${toolkit}"`)
      const isConnected = await checkConnectionStatus(toolkit)
      await syncConnectedToolkits()
      console.log(
        `[ComposioIPC] composio:check-status result toolkit="${toolkit}" isConnected=${isConnected}`
      )
      return { success: true, isConnected }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  // Disconnect a toolkit
  ipcMain.handle('composio:disconnect', async (_event, toolkit: string) => {
    try {
      await disconnectToolkit(toolkit)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })
}
