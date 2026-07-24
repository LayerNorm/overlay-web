import { IpcMainInvokeEvent, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'

const TRUSTED_ORIGINS = new Set<string>()

if (is.dev) {
  TRUSTED_ORIGINS.add('http://localhost:5173')
} else {
  TRUSTED_ORIGINS.add('file://')
}

export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (!senderWindow) return false

  const senderUrl = event.senderFrame?.url || event.sender.getURL()
  if (!senderUrl) return false

  for (const origin of TRUSTED_ORIGINS) {
    if (senderUrl.startsWith(origin)) return true
  }

  return false
}

export function validateSender(event: IpcMainInvokeEvent, channel: string): void {
  if (!isTrustedSender(event)) {
    console.warn(`[IPC Security] Blocked untrusted call to ${channel} from: ${event.senderFrame?.url}`)
    throw new Error('IPC call from untrusted origin')
  }
}
