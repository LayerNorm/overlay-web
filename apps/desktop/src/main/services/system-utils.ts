import { clipboard, desktopCapturer, screen, systemPreferences } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'path'
import { getResourcePath } from '../utils/resources'
import { tmpdir } from 'node:os'
import { ScreenshotResult } from '../types'
import { sendGlobalKey, type GlobalKeyCommand } from './global-keyboard'

const execFileAsync = promisify(execFile)

class SystemUtils {
  private async sendNativeGlobalKey(command: GlobalKeyCommand): Promise<void> {
    if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
      throw new Error('accessibility_permission_required')
    }

    const { uIOhook, UiohookKey } = await import('uiohook-napi')
    if (command === 'paste') {
      const modifier = process.platform === 'darwin' ? UiohookKey.Meta : UiohookKey.Ctrl
      uIOhook.keyTap(UiohookKey.V, [modifier])
    } else {
      uIOhook.keyTap(UiohookKey.Enter)
    }
  }

  private async sendSystemEventsGlobalKey(command: GlobalKeyCommand): Promise<void> {
    if (process.platform !== 'darwin') {
      throw new Error('system_events_global_keyboard_unsupported')
    }

    const script =
      command === 'paste'
        ? 'tell application "System Events" to keystroke "v" using {command down}'
        : 'tell application "System Events" to keystroke return'

    try {
      await execFileAsync('osascript', ['-e', script])
    } catch (firstError) {
      // Error -600 commonly appears after sleep/unlock when System Events was
      // terminated. Relaunch it once before surfacing a delivery failure.
      await execFileAsync('open', ['-gj', '-a', 'System Events']).catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 100))
      try {
        await execFileAsync('osascript', ['-e', script])
      } catch (retryError) {
        throw new AggregateError([firstError, retryError], `global_${command}_injection_failed`)
      }
    }
  }

  private async sendGlobalKey(command: GlobalKeyCommand): Promise<void> {
    const driver = await sendGlobalKey(command, {
      sendNative: (requestedCommand) => this.sendNativeGlobalKey(requestedCommand),
      sendWithSystemEvents: (requestedCommand) => this.sendSystemEventsGlobalKey(requestedCommand)
    })
    console.log(`[GlobalKeyboard] Sent ${command} via ${driver}`)
  }

  playSound(soundFile: string, volume: number = 0.1, soundEffectsEnabled: boolean): void {
    if (soundEffectsEnabled && process.platform === 'darwin') {
      execFile('afplay', ['-v', volume.toString(), getResourcePath(soundFile)], () => {})
    }
  }

  async getMacVolume(): Promise<number> {
    return new Promise((resolve, reject) => {
      execFile('osascript', ['-e', 'output volume of (get volume settings)'], (err, stdout) => {
        if (err) return reject(err)
        resolve(parseInt(stdout.trim()))
      })
    })
  }

  async setMacVolume(volume: number): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile('osascript', ['-e', `set volume output volume ${volume}`], (err) => {
        if (err) return reject(err)
        resolve()
      })
    })
  }

  async detectEditingMode(): Promise<{ isEditing: boolean; selectedText: string }> {
    const originalClipboard = clipboard.readText()

    await new Promise<void>((resolve, reject) => {
      execFile(
        'osascript',
        ['-e', 'tell application "System Events" to keystroke "c" using {command down}'],
        (err) => (err ? reject(err) : resolve())
      )
    })

    await new Promise((resolve) => setTimeout(resolve, 150))

    const clipboardText = clipboard.readText()
    const isEditing = clipboardText.length > 0 && clipboardText !== originalClipboard

    return {
      isEditing,
      selectedText: isEditing ? clipboardText : ''
    }
  }

  /**
   * Captures the word before and after the cursor using Option+Shift+Arrow keys.
   * If both words exist, we're mid-sentence. This is faster than capturing entire lines.
   */
  async capturePrecedingContext(): Promise<{
    precedingText: string
    followingText: string
    isMidSentence: boolean
  }> {
    const originalClipboard = clipboard.readText()
    console.log('[Context] Starting word-level context capture...')

    try {
      // Step 1: Capture word BEFORE cursor (Option+Shift+Left to select preceding word)
      await new Promise<void>((resolve, reject) => {
        execFile(
          'osascript',
          [
            '-e',
            `tell application "System Events"
              key code 123 using {option down, shift down}
              delay 0.05
              keystroke "c" using {command down}
              delay 0.1
              key code 124
            end tell`
          ],
          (err) => (err ? reject(err) : resolve())
        )
      })

      await new Promise((resolve) => setTimeout(resolve, 80))
      const precedingWord = clipboard.readText()
      const hasPrecedingWord =
        precedingWord !== originalClipboard && precedingWord.trim().length > 0

      console.log('[Context] DEBUG - Preceding word raw:', JSON.stringify(precedingWord))
      console.log('[Context] DEBUG - Has preceding word:', hasPrecedingWord)

      // Step 2: Capture word AFTER cursor (Option+Shift+Right to select following word)
      await new Promise<void>((resolve, reject) => {
        execFile(
          'osascript',
          [
            '-e',
            `tell application "System Events"
              key code 124 using {option down, shift down}
              delay 0.05
              keystroke "c" using {command down}
              delay 0.1
              key code 123
            end tell`
          ],
          (err) => (err ? reject(err) : resolve())
        )
      })

      await new Promise((resolve) => setTimeout(resolve, 80))
      const followingWord = clipboard.readText()
      const hasFollowingWord =
        followingWord !== originalClipboard &&
        followingWord !== precedingWord &&
        followingWord.trim().length > 0

      console.log('[Context] DEBUG - Following word raw:', JSON.stringify(followingWord))
      console.log('[Context] DEBUG - Has following word:', hasFollowingWord)

      // Restore original clipboard
      setTimeout(() => {
        clipboard.writeText(originalClipboard)
      }, 150)

      // Use the captured words
      const before = hasPrecedingWord ? precedingWord : ''
      const after = hasFollowingWord ? followingWord : ''

      // Simple mid-sentence detection: if there's a word before AND after, we're mid-sentence
      const isMidSentence = hasPrecedingWord && hasFollowingWord

      console.log('[Context] === FINAL RESULT ===')
      console.log('[Context] Preceding word:', JSON.stringify(before))
      console.log('[Context] Following word:', JSON.stringify(after))
      console.log('[Context] Mid-sentence:', isMidSentence)

      return {
        precedingText: before,
        followingText: after,
        isMidSentence
      }
    } catch (error) {
      console.error('[Context] Failed to capture context:', error)
      return { precedingText: '', followingText: '', isMidSentence: false }
    }
  }

  async captureScreenshot(assistantScreenshotEnabled: boolean): Promise<string | null> {
    if (!assistantScreenshotEnabled) {
      return null
    }

    try {
      const screenshotPath = join(tmpdir(), `screenshot-${Date.now()}.png`)

      await new Promise<void>((resolve, reject) => {
        execFile('screencapture', ['-x', screenshotPath], (err) => {
          if (err) return reject(err)
          resolve()
        })
      })

      const fs = await import('fs')
      const imageBuffer = fs.readFileSync(screenshotPath)
      const base64Image = imageBuffer.toString('base64')
      fs.unlinkSync(screenshotPath)

      return `data:image/png;base64,${base64Image}`
    } catch (error) {
      console.error('Screenshot capture failed:', error)
      return null
    }
  }

  async captureScreenshots(): Promise<ScreenshotResult[]> {
    try {
      const displays = screen.getAllDisplays()
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: 1920,
          height: 1080
        },
        fetchWindowIcons: false
      })

      const screenshots = sources
        .map((source, index) => {
          const display = displays[index] || displays[0]
          const thumbnail = source.thumbnail
          // Check if thumbnail has valid dimensions
          if (!thumbnail || thumbnail.isEmpty()) {
            console.log(`[Screenshot] Skipping empty thumbnail for source: ${source.name}`)
            return null
          }
          const dataUrl = thumbnail.toDataURL()
          // Validate data URL - ensure it's not just an empty PNG header
          if (!dataUrl || dataUrl.length < 100) {
            console.log(`[Screenshot] Skipping invalid dataUrl for source: ${source.name}`)
            return null
          }
          return {
            dataUrl,
            displayId: source.id,
            name: source.name,
            bounds: display.bounds
          }
        })
        .filter((s): s is NonNullable<typeof s> => s !== null)

      return screenshots
    } catch (error) {
      console.error('Failed to capture screenshots:', error)
      return []
    }
  }

  async pasteText(
    text: string,
    autoCopyEnabled: boolean,
    pressEnterAfterEnabled: boolean
  ): Promise<boolean> {
    if (!text) return false
    const previousClipboardContent = clipboard.readText()
    // Add space after punctuation for natural continuation
    const textWithSpace = text + ' '
    clipboard.writeText(textWithSpace)

    await this.sendGlobalKey('paste')

    if (pressEnterAfterEnabled) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100)
      })
      await this.sendGlobalKey('enter')
    }

    if (!autoCopyEnabled) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 500)
      })
      clipboard.writeText(previousClipboardContent)
    }

    return true
  }
}

export const systemUtils = new SystemUtils()
