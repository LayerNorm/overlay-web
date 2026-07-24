import { app, shell, BrowserWindow } from 'electron'
import { ipcMain } from '../services/security/secure-ipc-main'
import { join, resolve } from 'path'
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  unlinkSync
} from 'node:fs'
import { windowManager } from '../services/window-manager'
import { panelManager } from '../services/panel-manager'
import { getUnifiedKnowledgeService } from '../services/memory/UnifiedKnowledgeService'
import { validateSender } from '../utils/ipc-security'
import { assertSafeExternalUrl } from '../services/security/network-destination-policy'
import { seedDefaultSkills } from '../services/memory/DefaultSkillSeeder'

// Notebook persistence paths
let notesDir: string
let lastOpenedPath: string
let imagesDir: string

function broadcastNotesChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('notebook:notes-changed')
  }
}

// Validate that a note ID is safe and the resulting path stays within notesDir
function validateNotePath(id: string): string {
  if (!id || /[/\\]/.test(id) || id.includes('..')) {
    throw new Error(`Invalid note ID: ${id}`)
  }
  const filePath = join(notesDir, `${id}.md`)
  if (!resolve(filePath).startsWith(resolve(notesDir))) {
    throw new Error(`Invalid note ID: ${id}`)
  }
  return filePath
}

function initializeNotebookPaths(): void {
  notesDir = join(app.getPath('userData'), 'notes')
  lastOpenedPath = join(app.getPath('userData'), 'last-opened-note.txt')
  imagesDir = join(notesDir, 'images')

  // Ensure notes directory exists
  if (!existsSync(notesDir)) {
    mkdirSync(notesDir, { recursive: true })
  }

  // Ensure images directory exists
  if (!existsSync(imagesDir)) {
    mkdirSync(imagesDir, { recursive: true })
  }
}

export function registerNotebookIPC(): void {
  // Initialize paths
  initializeNotebookPaths()

  // Seed built-in skills on first run (non-blocking)
  void seedDefaultSkills()

  // Save dropped image to local directory
  ipcMain.handle(
    'notebook:save-image',
    async (_evt, { data, mimeType }: { data: string; mimeType: string }) => {
      try {
        // Generate filename from timestamp
        const now = new Date()
        const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
        const ext = mimeType.split('/')[1] || 'png'
        const filename = `image_${timestamp}.${ext}`
        const filePath = join(imagesDir, filename)

        // Convert base64 to buffer and save
        const base64Data = data.replace(/^data:image\/\w+;base64,/, '')
        const buffer = Buffer.from(base64Data, 'base64')
        writeFileSync(filePath, buffer)

        console.log('[Notebook] Image saved:', filePath)
        return { success: true, path: filePath }
      } catch (error) {
        console.error('[Notebook] Failed to save image:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  ipcMain.handle(
    'notebook:save',
    async (
      _evt,
      note: {
        id: string
        title: string
        content: string
        folderId?: string
        skill?: Record<string, unknown>
        updatedAt?: number
      }
    ) => {
      try {
        const filePath = validateNotePath(note.id)
        const now = note.updatedAt ?? Date.now()
        const metaObj: Record<string, unknown> = {
          id: note.id,
          title: note.title,
          updatedAt: now
        }
        if (note.skill !== undefined) {
          metaObj.skill = note.skill
        } else {
          // Preserve existing skill metadata when re-saving without explicit skill field
          if (existsSync(filePath)) {
            try {
              const existing = readFileSync(filePath, 'utf-8')
              const existingMatch = existing.match(/^---\n([\s\S]*?)\n---\n/)
              if (existingMatch) {
                const existingMeta = JSON.parse(existingMatch[1])
                if (existingMeta.skill) metaObj.skill = existingMeta.skill
              }
            } catch {
              // ignore parse errors
            }
          }
        }
        const metadata = JSON.stringify(metaObj)
        const content = `---\n${metadata}\n---\n${note.content}`
        writeFileSync(filePath, content, 'utf-8')
        broadcastNotesChanged()

        return { success: true }
      } catch (error) {
        console.error('[Notebook] Failed to save note:', error)
        return { success: false }
      }
    }
  )

  ipcMain.handle('notebook:load-all', async () => {
    try {
      const files = readdirSync(notesDir).filter((f: string) => f.endsWith('.md'))
      const notes = files
        .map((filename: string) => {
          try {
            const filePath = join(notesDir, filename)
            const content = readFileSync(filePath, 'utf-8')
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
            if (frontmatterMatch) {
              const metadata = JSON.parse(frontmatterMatch[1])
              return {
                id: metadata.id,
                title: metadata.title,
                updatedAt: metadata.updatedAt
              }
            }
            return null
          } catch {
            return null
          }
        })
        .filter((n): n is { id: string; title: string; updatedAt: number } => n !== null)
      // Sort by updatedAt descending
      notes.sort((a, b) => b.updatedAt - a.updatedAt)
      return notes
    } catch (error) {
      console.error('[Notebook] Failed to load notes:', error)
      return []
    }
  })

  ipcMain.handle('notebook:load', async (_evt, id: string) => {
    try {
      const filePath = validateNotePath(id)
      if (!existsSync(filePath)) {
        return null
      }
      const content = readFileSync(filePath, 'utf-8')
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/)
      if (frontmatterMatch) {
        const metadata = JSON.parse(frontmatterMatch[1])
        const noteContent = content.slice(frontmatterMatch[0].length)
        return {
          id: metadata.id,
          title: metadata.title,
          content: noteContent,
          updatedAt: metadata.updatedAt,
          skill: metadata.skill ?? undefined
        }
      }
      return null
    } catch (error) {
      console.error('[Notebook] Failed to load note:', error)
      return null
    }
  })

  // Return all notes that have skill metadata (skill notes)
  ipcMain.handle('notebook:get-skills', async () => {
    try {
      const files = readdirSync(notesDir).filter((f: string) => f.endsWith('.md'))
      const skills: Array<{
        id: string
        title: string
        updatedAt: number
        skill: Record<string, unknown>
      }> = []

      for (const filename of files) {
        try {
          const filePath = join(notesDir, filename)
          const content = readFileSync(filePath, 'utf-8')
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/)
          if (frontmatterMatch) {
            const metadata = JSON.parse(frontmatterMatch[1])
            if (metadata.skill) {
              skills.push({
                id: metadata.id,
                title: metadata.title,
                updatedAt: metadata.updatedAt,
                skill: metadata.skill
              })
            }
          }
        } catch {
          // Skip malformed files
        }
      }

      return skills.sort((a, b) => b.updatedAt - a.updatedAt)
    } catch (error) {
      console.error('[Notebook] Failed to get skills:', error)
      return []
    }
  })

  // Increment usageCount and set lastUsedAt for a skill note
  ipcMain.handle('notebook:update-skill-usage', async (_evt, id: string) => {
    try {
      const filePath = validateNotePath(id)
      if (!existsSync(filePath)) return { success: false }
      const raw = readFileSync(filePath, 'utf-8')
      const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n/)
      if (!frontmatterMatch) return { success: false }
      const metadata = JSON.parse(frontmatterMatch[1])
      if (!metadata.skill) return { success: false }
      const noteContent = raw.slice(frontmatterMatch[0].length)
      metadata.skill.usageCount = (metadata.skill.usageCount ?? 0) + 1
      metadata.skill.lastUsedAt = Date.now()
      metadata.updatedAt = Date.now()
      const newContent = `---\n${JSON.stringify(metadata)}\n---\n${noteContent}`
      writeFileSync(filePath, newContent, 'utf-8')
      broadcastNotesChanged()
      return { success: true }
    } catch (error) {
      console.error('[Notebook] Failed to update skill usage:', error)
      return { success: false }
    }
  })

  ipcMain.handle('notebook:delete', async (_evt, id: string) => {
    try {
      const filePath = validateNotePath(id)
      if (existsSync(filePath)) {
        unlinkSync(filePath)
      }

      // Remove note from index (async, don't block delete)
      getUnifiedKnowledgeService()
        .removeNoteFromIndex(id)
        .catch((err) => console.error('[Notebook] Failed to remove note from index:', err))
      broadcastNotesChanged()

      return { success: true }
    } catch (error) {
      console.error('[Notebook] Failed to delete note:', error)
      return { success: false }
    }
  })

  ipcMain.handle('notebook:get-last-opened', async () => {
    try {
      if (existsSync(lastOpenedPath)) {
        return readFileSync(lastOpenedPath, 'utf-8').trim()
      }
      return null
    } catch {
      return null
    }
  })

  ipcMain.handle('notebook:set-last-opened', async (_evt, id: string) => {
    try {
      writeFileSync(lastOpenedPath, id, 'utf-8')
    } catch (error) {
      console.error('[Notebook] Failed to save last opened note:', error)
    }
  })

  ipcMain.handle('notebook:get-folder', async () => {
    return notesDir
  })

  ipcMain.handle('notebook:open-folder', async () => {
    await shell.openPath(notesDir)
  })

  ipcMain.handle('shell:open-external', async (event, url: string) => {
    validateSender(event, 'shell:open-external')
    const parsed = await assertSafeExternalUrl(url, { allowLocalDevelopment: !app.isPackaged })
    await shell.openExternal(parsed.toString())
  })

  // Send text to notebook input handler
  ipcMain.handle('notebook:send-text-to-input', async (_evt, text: string) => {
    const existingPanel = windowManager.findWindowByType('notebook')

    if (existingPanel) {
      // Panel already exists and loaded - send text immediately
      existingPanel.webContents.send('notebook:input-text', text)
      existingPanel.focus()
      return { success: true }
    }

    // Create new panel and wait for it to fully load
    panelManager.createPanelWindow('notebook')

    // Wait for the panel to be ready
    return new Promise((resolve) => {
      const checkPanel = setInterval(() => {
        const panel = windowManager.findWindowByType('notebook')
        if (panel) {
          clearInterval(checkPanel)
          // Wait for did-finish-load event
          panel.webContents.once('did-finish-load', () => {
            // Small delay to ensure React has mounted
            setTimeout(() => {
              panel.webContents.send('notebook:input-text', text)
              panel.focus()
              resolve({ success: true })
            }, 150)
          })
          // If already loaded, send immediately
          if (!panel.webContents.isLoading()) {
            setTimeout(() => {
              panel.webContents.send('notebook:input-text', text)
              panel.focus()
              resolve({ success: true })
            }, 150)
          }
        }
      }, 50)

      // Timeout after 3 seconds
      setTimeout(() => {
        clearInterval(checkPanel)
        resolve({ success: false, error: 'Timeout waiting for notebook panel' })
      }, 3000)
    })
  })

  // Send text to new note handler
  ipcMain.handle('notebook:send-text-to-new', async (_evt, text: string) => {
    const existingPanel = windowManager.findWindowByType('notebook')

    if (existingPanel) {
      existingPanel.webContents.send('notebook:new-with-text', text)
      existingPanel.focus()
      return { success: true }
    }

    panelManager.createPanelWindow('notebook')

    return new Promise((resolve) => {
      const checkPanel = setInterval(() => {
        const panel = windowManager.findWindowByType('notebook')
        if (panel) {
          clearInterval(checkPanel)
          panel.webContents.once('did-finish-load', () => {
            setTimeout(() => {
              panel.webContents.send('notebook:new-with-text', text)
              panel.focus()
              resolve({ success: true })
            }, 150)
          })
          if (!panel.webContents.isLoading()) {
            setTimeout(() => {
              panel.webContents.send('notebook:new-with-text', text)
              panel.focus()
              resolve({ success: true })
            }, 150)
          }
        }
      }, 50)

      setTimeout(() => {
        clearInterval(checkPanel)
        resolve({ success: false, error: 'Timeout waiting for notebook panel' })
      }, 3000)
    })
  })
}
