import { app, dialog, shell } from 'electron'
import { ipcMain } from '../services/security/secure-ipc-main'

import { NativeKnowledgeFileStore } from '../services/native-knowledge-files'
import { validateSender } from '../utils/ipc-security'

export function registerKnowledgeFilesIPC(): void {
  const store = new NativeKnowledgeFileStore(app.getPath('userData'))

  ipcMain.handle(
    'knowledge-files:pick',
    async (event, options: { multiple?: boolean; directory?: boolean }) => {
      validateSender(event, 'knowledge-files:pick')
      const result = await dialog.showOpenDialog({
        properties: options.directory
          ? ['openDirectory']
          : options.multiple
            ? ['openFile', 'multiSelections']
            : ['openFile'],
      })
      if (result.canceled) return []
      return store.registerSelection(result.filePaths, options.directory ? result.filePaths[0] : undefined)
    },
  )
  ipcMain.handle('knowledge-files:read-picked', (event, token: string) => {
    validateSender(event, 'knowledge-files:read-picked')
    return store.readSelection(token)
  })
  ipcMain.handle(
    'knowledge-files:reveal-downloaded',
    (event, input: { name: string; dataBase64: string }) => {
      validateSender(event, 'knowledge-files:reveal-downloaded')
      const path = store.cacheDownloadedFile(input.name, input.dataBase64)
      shell.showItemInFolder(path)
      return { success: true, path }
    },
  )
}
