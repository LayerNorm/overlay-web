import { dialog, BrowserWindow } from 'electron'
import { ipcMain } from '../services/security/secure-ipc-main'
import { runtimeService } from '../services/runtime/runtime-service'

export function registerRuntimeIPC(): void {
  ipcMain.handle('runtime:ensure-python', async () => {
    return runtimeService.ensurePythonRuntime()
  })

  ipcMain.handle(
    'runtime:run-script',
    async (
      _event,
      options: {
        runtime: 'python' | 'javascript'
        code: string
        packages?: string[]
        cwd?: string
        timeoutMs?: number
      }
    ) => {
      return runtimeService.runScript(options)
    }
  )

  ipcMain.handle(
    'runtime:install-packages',
    async (_event, { packages }: { packages: string[] }) => {
      return runtimeService.installPackages(packages)
    }
  )

  ipcMain.handle('runtime:cleanup', async () => {
    return { cleaned: runtimeService.cleanup() }
  })

  // ── Working Folder Picker ──────────────────────────────────────────────

  ipcMain.handle('runtime:pick-working-folder', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return { cancelled: true }

    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Working Folder',
      buttonLabel: 'Select Folder'
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { cancelled: true }
    }

    return { cancelled: false, path: result.filePaths[0] }
  })
}
