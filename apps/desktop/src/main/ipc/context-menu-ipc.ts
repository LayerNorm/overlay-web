import { Menu, BrowserWindow } from 'electron'
import { ipcMain } from '../services/security/secure-ipc-main'

interface ContextMenuItem {
  id: string
  label: string
  accelerator?: string
  enabled?: boolean
  type?: 'normal' | 'separator'
}

export function registerContextMenuIPC(): void {
  ipcMain.handle(
    'context-menu:show',
    async (event, { items }: { items: ContextMenuItem[] }): Promise<{ clicked: string | null }> => {
      return new Promise((resolve) => {
        const window = BrowserWindow.fromWebContents(event.sender)
        if (!window) {
          resolve({ clicked: null })
          return
        }

        let clickedId: string | null = null

        const menuTemplate = items.map((item) => {
          if (item.type === 'separator') {
            return { type: 'separator' as const }
          }
          return {
            label: item.label,
            accelerator: item.accelerator,
            enabled: item.enabled !== false,
            click: () => {
              clickedId = item.id
            }
          }
        })

        const menu = Menu.buildFromTemplate(menuTemplate)

        menu.popup({
          window,
          callback: () => {
            resolve({ clicked: clickedId })
          }
        })
      })
    }
  )
}
