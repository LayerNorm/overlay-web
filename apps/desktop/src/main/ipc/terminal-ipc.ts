import { ipcMain } from '../services/security/secure-ipc-main'

import { terminalService } from '../services/terminal/terminal-service'

export function registerTerminalIPC(): void {
  // Create a new persistent terminal session
  ipcMain.handle('terminal:create-session', async (_event, { cwd }: { cwd?: string } = {}) => {
    try {
      const session = terminalService.createSession(cwd)
      return { success: true, sessionId: session.id, cwd: session.cwd }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // List active terminal sessions
  ipcMain.handle('terminal:list-sessions', async () => {
    return { success: true, sessions: terminalService.listSessions() }
  })

  // Write data to a terminal session
  ipcMain.handle(
    'terminal:write',
    async (_event, { sessionId, data }: { sessionId: string; data: string }) => {
      const ok = terminalService.writeToSession(sessionId, data)
      return { success: ok, error: ok ? undefined : 'Session not found' }
    }
  )

  // Read output from a terminal session
  ipcMain.handle(
    'terminal:read',
    async (_event, { sessionId, lastN }: { sessionId: string; lastN?: number }) => {
      const output = terminalService.readSessionOutput(sessionId, lastN)
      if (output === null) {
        return { success: false, error: 'Session not found', output: '' }
      }
      return { success: true, output }
    }
  )

  // Resize a terminal session
  ipcMain.handle(
    'terminal:resize',
    async (
      _event,
      { sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }
    ) => {
      const ok = terminalService.resizeSession(sessionId, cols, rows)
      return { success: ok, error: ok ? undefined : 'Session not found' }
    }
  )

  // Kill a terminal session
  ipcMain.handle('terminal:kill', async (_event, { sessionId }: { sessionId: string }) => {
    const ok = terminalService.killSession(sessionId)
    return { success: ok, error: ok ? undefined : 'Session not found' }
  })

  // Run a one-shot command (no persistent session)
  ipcMain.handle(
    'terminal:run',
    async (
      _event,
      { command, cwd, timeoutMs }: { command: string; cwd?: string; timeoutMs?: number }
    ) => {
      try {
        const result = await terminalService.runCommand(command, { cwd, timeoutMs })
        return result
      } catch (err) {
        return {
          success: false,
          stdout: '',
          stderr: '',
          error: err instanceof Error ? err.message : String(err)
        }
      }
    }
  )

  // Stream terminal output to renderer (for live terminal UI)
  ipcMain.handle('terminal:subscribe', async (event, { sessionId }: { sessionId: string }) => {
    const session = terminalService.getSession(sessionId)
    if (!session) {
      return { success: false, error: 'Session not found' }
    }

    const webContents = event.sender
    const handler = (data: string): void => {
      if (!webContents.isDestroyed()) {
        webContents.send('terminal:data', { sessionId, data })
      }
    }

    session.pty.onData(handler)
    return { success: true }
  })
}
