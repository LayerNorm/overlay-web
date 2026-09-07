import { ipcMain } from '../services/security/secure-ipc-main'
import { embeddedHostService } from '../services/embedded-host-service'
import { isEmbeddedHostAdapter } from '../services/embedded-host-config'

export function registerEmbeddedHostIPC(): void {
  ipcMain.handle('embedded-host:start', (_event, input: unknown) => {
    const record = (input ?? {}) as Record<string, unknown>
    const code = typeof record.code === 'string' ? record.code : ''
    const adapterId = typeof record.adapterId === 'string' ? record.adapterId : ''
    if (!isEmbeddedHostAdapter(adapterId)) throw new Error('Unsupported harness.')
    return embeddedHostService.start({ code, adapterId })
  })

  ipcMain.handle('embedded-host:stop', () => {
    return embeddedHostService.stop()
  })

  ipcMain.handle('embedded-host:status', () => {
    return embeddedHostService.getStatus()
  })
}
