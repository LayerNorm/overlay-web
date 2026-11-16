import { clipboard, systemPreferences } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { deliverDictation } from './dictation-delivery'
import { sendGlobalKey, type GlobalKeyCommand } from './global-keyboard'

const execFileAsync = promisify(execFile)

class SystemUtils {
  private async sendNativeGlobalKey(
    command: GlobalKeyCommand,
    active: () => boolean = () => true
  ): Promise<void> {
    if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
      throw new Error('accessibility_permission_required')
    }

    const { uIOhook, UiohookKey } = await import('uiohook-napi')
    if (!active()) throw new Error('Dictation was cancelled.')
    if (command === 'paste') {
      const modifier = process.platform === 'darwin' ? UiohookKey.Meta : UiohookKey.Ctrl
      uIOhook.keyTap(UiohookKey.V, [modifier])
    } else {
      uIOhook.keyTap(UiohookKey.Enter)
    }
  }

  private async sendSystemEventsGlobalKey(
    command: GlobalKeyCommand,
    active: () => boolean = () => true
  ): Promise<void> {
    if (process.platform !== 'darwin') {
      throw new Error('system_events_global_keyboard_unsupported')
    }

    const script =
      command === 'paste'
        ? 'tell application "System Events" to keystroke "v" using {command down}'
        : 'tell application "System Events" to keystroke return'

    try {
      if (!active()) throw new Error('Dictation was cancelled.')
      await execFileAsync('osascript', ['-e', script])
    } catch (firstError) {
      // Error -600 commonly appears after sleep/unlock when System Events was
      // terminated. Relaunch it once before surfacing a delivery failure.
      await execFileAsync('open', ['-gj', '-a', 'System Events']).catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 100))
      try {
        if (!active()) throw new Error('Dictation was cancelled.')
        await execFileAsync('osascript', ['-e', script])
      } catch (retryError) {
        throw new AggregateError([firstError, retryError], `global_${command}_injection_failed`)
      }
    }
  }

  private async sendGlobalKey(
    command: GlobalKeyCommand,
    active: () => boolean = () => true
  ): Promise<void> {
    const driver = await sendGlobalKey(command, {
      sendNative: (requestedCommand) => this.sendNativeGlobalKey(requestedCommand, active),
      sendWithSystemEvents: (requestedCommand) =>
        this.sendSystemEventsGlobalKey(requestedCommand, active)
    })
    console.log(`[GlobalKeyboard] Sent ${command} via ${driver}`)
  }

  async dictationTarget(): Promise<number | null> {
    if (process.platform !== 'darwin') return null
    try {
      const { stdout } = await execFileAsync(
        'osascript',
        [
          '-e',
          'tell application "System Events" to get unix id of first application process whose frontmost is true'
        ],
        { timeout: 1500, maxBuffer: 1024 }
      )
      const pid = Number(stdout.trim())
      return Number.isSafeInteger(pid) && pid > 0 ? pid : null
    } catch {
      return null
    }
  }

  async deliverDictation(
    text: string,
    target: number | null,
    active: () => boolean
  ): Promise<'inserted' | 'copy'> {
    return deliverDictation(text, target, {
      currentTarget: () => this.dictationTarget(),
      snapshot: () => {
        const formats = clipboard.availableFormats()
        // File promises and application-specific formats must not be destroyed by dictation.
        if (
          formats.some(
            (format) =>
              ![
                'text/plain',
                'text/html',
                'text/rtf',
                'image/png',
                'public.utf8-plain-text',
                'public.html',
                'public.rtf',
                'public.png'
              ].includes(format)
          )
        )
          return null
        return {
          text: clipboard.readText(),
          html: clipboard.readHTML(),
          rtf: clipboard.readRTF(),
          image: clipboard.readImage()
        }
      },
      write: (value) => clipboard.writeText(value),
      read: () => clipboard.readText(),
      restore: (value) => {
        clipboard.clear()
        clipboard.write(value)
      },
      paste: async () => {
        await this.sendGlobalKey('paste', active)
        await new Promise((resolve) => setTimeout(resolve, 300))
      },
      active
    })
  }
}

export const systemUtils = new SystemUtils()
