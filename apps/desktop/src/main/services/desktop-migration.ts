import { app, BrowserWindow, dialog, shell } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Preserve legacy local data before replacing its renderer. Never upload it implicitly. */
export async function migrateLegacyDesktopData(): Promise<void> {
  const marker = join(app.getPath('userData'), 'web-shell-migration-v1.json')
  if (existsSync(marker)) return
  const hadLegacy =
    existsSync(join(app.getPath('userData'), 'settings.json')) ||
    existsSync(join(app.getPath('userData'), 'knowledge-migration'))
  if (!hadLegacy) {
    writeFileSync(marker, JSON.stringify({ version: 1, legacy: false }), { mode: 0o600 })
    return
  }
  const backup = join(app.getPath('userData'), 'legacy-desktop-export')
  mkdirSync(backup, { recursive: true, mode: 0o700 })
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  try {
    // The old local app used this exact file URL and the default partition.
    await window.loadFile(join(__dirname, '../renderer/index.html'))
    const records = await window.webContents.executeJavaScript(`(() => {
      const read = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null } }
      const settings = read('overlay-settings') || {}
      const allowed = ['selectedModelId', 'localTranscriptionEnabled', 'transcriptionPriority', 'autoCopy', 'pressEnterAfter', 'recordingStorageEnabled', 'recordingStorageRetention', 'phraseReplacements', 'dictionaryWords']
      return { transcriptions: read('transcriptions'), settings: Object.fromEntries(allowed.filter((key) => key in settings).map((key) => [key, settings[key]])) }
    })()`)
    writeFileSync(join(backup, 'transcripts-and-settings.json'), JSON.stringify(records, null, 2), {
      mode: 0o600
    })
    writeFileSync(marker, JSON.stringify({ version: 1, legacy: true, exportedAt: Date.now() }), {
      mode: 0o600
    })
  } catch {
    dialog.showErrorBox(
      'Could not export old desktop data',
      'Your existing local data is unchanged. Overlay will try the export again next time. You can open the preserved-data folder from Desktop settings.'
    )
    return
  } finally {
    window.destroy()
  }
  // All existing recordings, local knowledge files and migration journals remain in place.
  const notice = await dialog.showMessageBox({
    type: 'info',
    title: 'Overlay now uses the web app',
    message: 'Your desktop now has the same features as Overlay on the web.',
    detail:
      'Sign in again to continue. Local transcripts and native preferences have been exported on this Mac. Recordings, local knowledge files and migration journals are preserved. Browser bookmarks, old chat tabs and assistant preferences are no longer used. Desktop settings includes a button to open this data folder.',
    buttons: ['Continue', 'Show preserved data'],
    defaultId: 0
  })
  if (notice.response === 1) await shell.openPath(app.getPath('userData'))
}
