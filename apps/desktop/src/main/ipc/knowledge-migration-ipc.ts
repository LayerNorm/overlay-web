import { app } from 'electron'
import { ipcMain } from '../services/security/secure-ipc-main'
import type { KnowledgeMigrationJournal } from '@overlay/app-core'

import { KnowledgeMigrationStore } from '../services/knowledge-migration-store'
import { validateSender } from '../utils/ipc-security'

export function registerKnowledgeMigrationIPC(): void {
  const store = new KnowledgeMigrationStore(app.getPath('userData'))

  ipcMain.handle('knowledge-migration:inventory', (event) => {
    validateSender(event, 'knowledge-migration:inventory')
    return store.inventory()
  })
  ipcMain.handle('knowledge-migration:read-asset', (event, assetId: string) => {
    validateSender(event, 'knowledge-migration:read-asset')
    return store.readAsset(assetId)
  })
  ipcMain.handle('knowledge-migration:create-backup', (event, userId: string) => {
    validateSender(event, 'knowledge-migration:create-backup')
    return store.createBackup(userId)
  })
  ipcMain.handle('knowledge-migration:load-journal', (event, userId: string) => {
    validateSender(event, 'knowledge-migration:load-journal')
    return store.loadJournal(userId)
  })
  ipcMain.handle(
    'knowledge-migration:save-journal',
    (event, userId: string, journal: KnowledgeMigrationJournal) => {
      validateSender(event, 'knowledge-migration:save-journal')
      store.saveJournal(userId, journal)
      return { success: true }
    },
  )
}
