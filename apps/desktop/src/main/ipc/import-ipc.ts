import { dialog, app, BrowserWindow } from 'electron'
import { ipcMain } from '../services/security/secure-ipc-main'
import { join, basename, extname, dirname, relative } from 'path'
import { existsSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { marked } from 'marked'

const execFileAsync = promisify(execFile)

// Configure marked for GFM (tables, task lists, strikethrough, etc.)
marked.setOptions({
  gfm: true,
  breaks: true // Treat single newlines as <br> (common in note-taking apps)
})

/**
 * Convert Markdown text to HTML that TipTap can render.
 * Handles GFM features (tables, task lists, strikethrough), headings, links, etc.
 * Strips the leading H1 if present (since title is stored separately).
 */
function markdownToHtml(md: string, stripFirstHeading = false): string {
  let text = md

  if (stripFirstHeading) {
    // If the first line is a # heading, remove it (title is stored separately in metadata)
    text = text.replace(/^\s*#\s+[^\n]*\n?/, '')
  }

  // Convert [[wikilinks]] to plain text (Obsidian-specific)
  text = text.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_match, target, alias) => {
    return alias || target
  })

  const html = marked.parse(text)
  // marked.parse can return string or Promise<string>; since we're sync config it's string
  if (typeof html !== 'string') {
    return String(html)
  }
  return html
}

// Canonical imported note type
interface ImportedNote {
  title: string
  content: string
  createdAt?: number
  updatedAt?: number
  tags: string[]
  source: string
  sourceId?: string
  folderPath?: string[]
}

// ─── Detection ──────────────────────────────────────────────────────────

async function detectInstalledApps(): Promise<{
  obsidian: boolean
  bear: boolean
  appleNotes: boolean
}> {
  const results = { obsidian: false, bear: false, appleNotes: false }

  if (process.platform !== 'darwin') {
    return results
  }

  // Use mdfind (Spotlight) to check bundle IDs
  const bundleIds: Record<string, keyof typeof results> = {
    'md.obsidian': 'obsidian',
    'net.shinyfrog.bear': 'bear',
    'com.apple.Notes': 'appleNotes'
  }

  for (const [bundleId, key] of Object.entries(bundleIds)) {
    try {
      const { stdout } = await execFileAsync('mdfind', [
        `kMDItemCFBundleIdentifier == '${bundleId}'`
      ])
      results[key] = stdout.trim().length > 0
    } catch {
      // Fallback: check common paths
      if (key === 'obsidian') {
        results[key] =
          existsSync('/Applications/Obsidian.app') ||
          existsSync(join(app.getPath('home'), 'Applications/Obsidian.app'))
      } else if (key === 'bear') {
        results[key] =
          existsSync('/Applications/Bear.app') ||
          existsSync(join(app.getPath('home'), 'Applications/Bear.app'))
      } else if (key === 'appleNotes') {
        // Apple Notes is always present on macOS
        results[key] = true
      }
    }
  }

  return results
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Check if a path is inside an iCloud container.
 * iCloud-synced Obsidian vaults live under:
 *   ~/Library/Mobile Documents/iCloud~md~obsidian/
 * or the generic:
 *   ~/Library/Mobile Documents/com~apple~CloudDocs/
 */
function isICloudPath(dirPath: string): boolean {
  const home = app.getPath('home')
  const mobileDocuments = join(home, 'Library', 'Mobile Documents')
  return dirPath.startsWith(mobileDocuments)
}

/**
 * Check if a file is an iCloud placeholder (not downloaded).
 * iCloud creates `.filename.icloud` stubs for files not yet downloaded.
 */
function isICloudStub(fileName: string): boolean {
  return fileName.startsWith('.') && fileName.endsWith('.icloud')
}

interface CollectStats {
  /** Number of .icloud stub files found */
  iCloudStubs: number
  /** Number of 0-byte files skipped (likely evicted to iCloud or genuinely empty) */
  emptyFiles: number
}

/**
 * Recursively collect markdown file paths. Skips:
 *  - hidden dirs, node_modules, .obsidian, .trash
 *  - `.filename.icloud` stub files (iCloud placeholders)
 *  - 0-byte files (iCloud-evicted files on synced Desktop/Documents, or genuinely empty)
 *
 * Returns the list of real, non-empty file paths plus stats about what was skipped.
 */
function collectMarkdownPaths(
  dirPath: string,
  fileList: string[] = [],
  stats: CollectStats = { iCloudStubs: 0, emptyFiles: 0 }
): { files: string[]; stats: CollectStats } {
  let entries
  try {
    entries = readdirSync(dirPath, { withFileTypes: true })
  } catch {
    // Permission denied or unreadable dir — skip silently
    return { files: fileList, stats }
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)

    if (entry.isDirectory()) {
      // Skip hidden dirs, node_modules, .obsidian config, .trash
      if (
        entry.name.startsWith('.') ||
        entry.name === 'node_modules' ||
        entry.name === '.obsidian' ||
        entry.name === '.trash'
      ) {
        continue
      }
      collectMarkdownPaths(fullPath, fileList, stats)
    } else if (entry.isFile()) {
      // Skip iCloud stubs (`.filename.icloud`)
      if (isICloudStub(entry.name)) {
        stats.iCloudStubs++
        continue
      }

      const isMarkdown =
        entry.name.endsWith('.md') ||
        entry.name.endsWith('.markdown') ||
        entry.name.endsWith('.txt')

      if (!isMarkdown) continue

      // Skip 0-byte files — on iCloud-synced Desktop/Documents folders,
      // evicted files appear as 0-byte with no special attributes.
      // These have no content to import regardless of the reason.
      try {
        const fileStat = statSync(fullPath)
        if (fileStat.size === 0) {
          stats.emptyFiles++
          continue
        }
      } catch {
        // Can't stat — skip
        continue
      }

      fileList.push(fullPath)
    }
  }

  return { files: fileList, stats }
}

function parseMarkdownFrontmatter(content: string): {
  metadata: Record<string, unknown>
  body: string
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match) {
    return { metadata: {}, body: content }
  }

  const yamlBlock = match[1]
  const body = content.slice(match[0].length)
  const metadata: Record<string, unknown> = {}

  // Simple YAML-like parser for frontmatter (key: value pairs)
  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    let value: unknown = line.slice(colonIdx + 1).trim()

    // Handle arrays like [tag1, tag2]
    if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
    }

    metadata[key] = value
  }

  return { metadata, body }
}

function extractTagsFromContent(content: string): string[] {
  // Extract #tags from content (but not inside code blocks or links)
  const tagPattern = /(?:^|\s)#([a-zA-Z0-9_/-]+)/g
  const tags: Set<string> = new Set()
  let match: RegExpExecArray | null
  while ((match = tagPattern.exec(content)) !== null) {
    tags.add(match[1])
  }
  return Array.from(tags)
}

function generateNoteId(): string {
  return `import-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

function splitRelativeFolderPath(rootPath: string, filePath: string): string[] {
  const relativeDirPath = relative(rootPath, dirname(filePath))
  if (!relativeDirPath || relativeDirPath === '.') {
    return []
  }
  return relativeDirPath
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

/**
 * Yield control back to the event loop. Prevents the main thread from
 * freezing during heavy file I/O (the spinning beach ball).
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * Process an array in async batches, yielding between each batch so the
 * Electron main-process event loop stays responsive.
 */
async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const batchResults = await Promise.all(batch.map(processor))
    results.push(...batchResults)
    // Yield so the event loop can process IPC, rendering, etc.
    await yieldToEventLoop()
  }
  return results
}

function saveNoteToOverlay(note: ImportedNote): { success: boolean; id: string } {
  const notesDir = join(app.getPath('userData'), 'notes')
  if (!existsSync(notesDir)) {
    mkdirSync(notesDir, { recursive: true })
  }

  const id = generateNoteId()

  // Ensure title is never empty
  const title = (note.title || '').trim() || 'Untitled'

  const metadata = JSON.stringify({
    id,
    title,
    updatedAt: note.updatedAt || Date.now(),
    importedFrom: note.source,
    importedAt: Date.now(),
    tags: note.tags
  })

  // Convert markdown content to HTML so TipTap can render it properly.
  // Strip the first H1 heading if present since the title is stored separately.
  const htmlContent = markdownToHtml(note.content, true)

  const fileContent = `---\n${metadata}\n---\n${htmlContent}`
  const filePath = join(notesDir, `${id}.md`)
  writeFileSync(filePath, fileContent, 'utf-8')
  return { success: true, id }
}

function broadcastNotesChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('notebook:notes-changed')
    } catch {
      // Window may have been destroyed
    }
  }
}

// ─── Obsidian Importer ──────────────────────────────────────────────────

async function importObsidian(): Promise<{
  notes: ImportedNote[]
  error?: string
  cancelled?: boolean
  iCloudWarning?: string
}> {
  const result = await dialog.showOpenDialog({
    title: 'Select Obsidian Vault Folder',
    properties: ['openDirectory'],
    message: 'Choose your Obsidian vault folder to import notes from'
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { notes: [], cancelled: true }
  }

  const vaultPath = result.filePaths[0]

  // Detect iCloud-backed vaults
  const iCloud = isICloudPath(vaultPath)
  let iCloudWarning: string | undefined

  try {
    // Phase 1: Collect file paths (fast, synchronous directory walk)
    const { files: mdFiles, stats: collectStats } = collectMarkdownPaths(vaultPath)
    const skippedTotal = collectStats.iCloudStubs + collectStats.emptyFiles

    // Build iCloud warning based on what was found
    if (skippedTotal > 0) {
      const parts: string[] = []
      if (collectStats.emptyFiles > 0) {
        parts.push(`${collectStats.emptyFiles} empty/iCloud-evicted file(s)`)
      }
      if (collectStats.iCloudStubs > 0) {
        parts.push(`${collectStats.iCloudStubs} iCloud placeholder(s)`)
      }
      iCloudWarning = `${parts.join(' and ')} were skipped because they have no downloadable content. To import all notes, open the vault folder in Finder and wait for iCloud to finish downloading, then try again.`
    } else if (iCloud) {
      iCloudWarning =
        'This vault appears to be stored in iCloud. If some notes are missing, open the vault folder in Finder and wait for iCloud to finish downloading all files, then re-import.'
    }

    if (mdFiles.length === 0) {
      const msg =
        skippedTotal > 0
          ? `No importable notes found. ${skippedTotal} file(s) were empty or not downloaded from iCloud. Open the vault folder in Finder first to trigger iCloud downloads, then try again.`
          : 'No markdown files found in this folder.'
      return { notes: [], error: msg }
    }

    console.log(
      `[Import] Obsidian: found ${mdFiles.length} importable files in ${vaultPath}` +
        (skippedTotal > 0
          ? ` (skipped: ${collectStats.emptyFiles} empty, ${collectStats.iCloudStubs} iCloud stubs)`
          : '')
    )

    // Phase 2: Read files in async batches (prevents event-loop starvation)
    const BATCH_SIZE = 30
    const notes = await processInBatches<string, ImportedNote | null>(
      mdFiles,
      BATCH_SIZE,
      async (filePath) => {
        try {
          const [raw, fileStat] = await Promise.all([readFile(filePath, 'utf-8'), stat(filePath)])

          const { metadata, body } = parseMarkdownFrontmatter(raw)

          // Title priority: frontmatter title → first H1 heading → filename
          let title = ''
          if (metadata.title && typeof metadata.title === 'string') {
            title = metadata.title.trim()
          }
          if (!title) {
            // Check for a leading # heading in the body
            const headingMatch = body.match(/^\s*#\s+(.+)/)
            if (headingMatch) {
              title = headingMatch[1].trim()
            }
          }
          if (!title) {
            title = basename(filePath, extname(filePath))
          }

          const frontmatterTags = Array.isArray(metadata.tags)
            ? (metadata.tags as string[])
            : typeof metadata.tags === 'string'
              ? [metadata.tags]
              : []
          const contentTags = extractTagsFromContent(body)
          const allTags = [...new Set([...frontmatterTags, ...contentTags])]
          const folderPath = splitRelativeFolderPath(vaultPath, filePath)

          return {
            title,
            content: body.trim(),
            createdAt: fileStat.birthtimeMs,
            updatedAt: fileStat.mtimeMs,
            tags: allTags,
            source: 'obsidian',
            sourceId: filePath,
            folderPath: folderPath.length > 0 ? folderPath : undefined
          }
        } catch (err) {
          console.error(`[Import] Failed to read Obsidian file ${filePath}:`, err)
          return null
        }
      }
    )

    const validNotes = notes.filter((n): n is ImportedNote => n !== null)
    console.log(`[Import] Obsidian: read ${validNotes.length} notes from ${vaultPath}`)
    return { notes: validNotes, iCloudWarning }
  } catch (error) {
    console.error('[Import] Obsidian import failed:', error)
    return { notes: [], error: String(error) }
  }
}

// ─── Bear Importer ──────────────────────────────────────────────────────

async function importBear(): Promise<{
  notes: ImportedNote[]
  error?: string
  cancelled?: boolean
}> {
  const result = await dialog.showOpenDialog({
    title: 'Select Bear Export Folder',
    properties: ['openDirectory'],
    message:
      'In Bear, go to File → Export Notes, choose Markdown, then select the exported folder here'
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { notes: [], cancelled: true }
  }

  const exportPath = result.filePaths[0]

  try {
    const { files: mdFiles, stats: collectStats } = collectMarkdownPaths(exportPath)
    const skippedTotal = collectStats.iCloudStubs + collectStats.emptyFiles

    if (mdFiles.length === 0) {
      return {
        notes: [],
        error:
          skippedTotal > 0
            ? `No importable notes found. ${skippedTotal} file(s) were empty or not downloaded.`
            : 'No markdown files found in this folder.'
      }
    }

    console.log(`[Import] Bear: found ${mdFiles.length} importable files in ${exportPath}`)

    const BATCH_SIZE = 30
    const notes = await processInBatches<string, ImportedNote | null>(
      mdFiles,
      BATCH_SIZE,
      async (filePath) => {
        try {
          const [raw, fileStat] = await Promise.all([readFile(filePath, 'utf-8'), stat(filePath)])

          // Bear markdown exports: title is the first # heading or filename
          const titleMatch = raw.match(/^#\s+(.+)/m)
          const title = titleMatch ? titleMatch[1].trim() : basename(filePath, extname(filePath))

          // Remove the title heading from body if present
          const body = titleMatch ? raw.replace(/^#\s+.+\n?/, '').trim() : raw.trim()

          // Bear uses #tags inline
          const tags = extractTagsFromContent(raw)
          const folderPath = splitRelativeFolderPath(exportPath, filePath)

          return {
            title,
            content: body,
            createdAt: fileStat.birthtimeMs,
            updatedAt: fileStat.mtimeMs,
            tags,
            source: 'bear',
            sourceId: filePath,
            folderPath: folderPath.length > 0 ? folderPath : undefined
          }
        } catch (err) {
          console.error(`[Import] Failed to read Bear file ${filePath}:`, err)
          return null
        }
      }
    )

    const validNotes = notes.filter((n): n is ImportedNote => n !== null)
    console.log(`[Import] Bear: read ${validNotes.length} notes from ${exportPath}`)
    return { notes: validNotes }
  } catch (error) {
    console.error('[Import] Bear import failed:', error)
    return { notes: [], error: String(error) }
  }
}

// ─── Apple Notes Importer ───────────────────────────────────────────────

async function importAppleNotes(): Promise<{
  notes: ImportedNote[]
  error?: string
}> {
  // Use JXA (JavaScript for Automation) to export Apple Notes
  const jxaScript = `
    const Notes = Application('Notes');
    Notes.includeStandardAdditions = true;
    const folders = Notes.folders();
    const result = [];

    function walkFolder(folder, parentPath) {
      const folderName = folder.name();
      const currentPath = parentPath.concat([folderName]);
      const notes = folder.notes();

      for (let i = 0; i < notes.length; i++) {
        try {
          const n = notes[i];
          result.push({
            title: n.name(),
            body: n.plaintext(),
            createdAt: n.creationDate().toISOString(),
            updatedAt: n.modificationDate().toISOString(),
            folderPath: currentPath,
            id: n.id()
          });
        } catch (e) {
          // Skip notes that can't be read (e.g., locked notes)
        }
      }

      const childFolders = folder.folders();
      for (let j = 0; j < childFolders.length; j++) {
        walkFolder(childFolders[j], currentPath);
      }
    }

    const accounts = Notes.accounts();
    for (let a = 0; a < accounts.length; a++) {
      const accountFolders = accounts[a].folders();
      for (let f = 0; f < accountFolders.length; f++) {
        walkFolder(accountFolders[f], []);
      }
    }

    if (result.length === 0) {
      for (let f = 0; f < folders.length; f++) {
        walkFolder(folders[f], []);
      }
    }

    JSON.stringify(result);
  `

  try {
    const { stdout } = await execFileAsync('osascript', ['-l', 'JavaScript', '-e', jxaScript], {
      timeout: 120000 // 2 minute timeout for large note libraries
    })

    const rawNotes = JSON.parse(stdout.trim()) as Array<{
      title: string
      body: string
      createdAt: string
      updatedAt: string
      folderPath?: string[]
      id: string
    }>

    const notes: ImportedNote[] = rawNotes.map((n) => {
      const folderPath = Array.isArray(n.folderPath)
        ? n.folderPath.map((segment) => String(segment).trim()).filter(Boolean)
        : []
      const leafFolder = folderPath.length > 0 ? folderPath[folderPath.length - 1] : ''

      return {
        title: n.title || 'Untitled',
        content: n.body || '',
        createdAt: new Date(n.createdAt).getTime(),
        updatedAt: new Date(n.updatedAt).getTime(),
        tags: leafFolder && leafFolder !== 'Notes' ? [leafFolder] : [],
        source: 'apple-notes',
        sourceId: n.id,
        folderPath: folderPath.length > 0 ? folderPath : undefined
      }
    })

    console.log(`[Import] Apple Notes: exported ${notes.length} notes`)
    return { notes }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('[Import] Apple Notes import failed:', errMsg)

    if (errMsg.includes('not allowed assistive access') || errMsg.includes('-1743')) {
      return {
        notes: [],
        error:
          'Automation permission denied. Please go to System Settings → Privacy & Security → Automation and allow Overlay to control Notes.'
      }
    }

    return { notes: [], error: errMsg }
  }
}

// ─── IPC Registration ───────────────────────────────────────────────────

export function registerImportIPC(): void {
  ipcMain.handle('import:detect-apps', async () => {
    return detectInstalledApps()
  })

  ipcMain.handle('import:obsidian', async () => {
    return importObsidian()
  })

  ipcMain.handle('import:bear', async () => {
    return importBear()
  })

  ipcMain.handle('import:apple-notes', async () => {
    return importAppleNotes()
  })

  ipcMain.handle('import:notify-notes-changed', async () => {
    broadcastNotesChanged()
    return { success: true }
  })

  // Save a batch of imported notes to the notebook — processes in async
  // batches to keep the main-process event loop responsive.
  ipcMain.handle(
    'import:save-notes',
    async (
      _,
      notes: ImportedNote[]
    ): Promise<{
      saved: number
      errors: number
      ids: string[]
      savedNotes: Array<{ id: string; folderPath?: string[] }>
    }> => {
      let saved = 0
      let errors = 0
      const ids: string[] = []
      const savedNotes: Array<{ id: string; folderPath?: string[] }> = []

      const SAVE_BATCH = 20
      for (let i = 0; i < notes.length; i += SAVE_BATCH) {
        const batch = notes.slice(i, i + SAVE_BATCH)
        for (const note of batch) {
          try {
            const result = saveNoteToOverlay(note)
            if (result.success) {
              saved++
              ids.push(result.id)
              savedNotes.push({ id: result.id, folderPath: note.folderPath })
            } else {
              errors++
            }
          } catch {
            errors++
          }
        }
        // Yield between save batches
        await yieldToEventLoop()
      }

      console.log(`[Import] Saved ${saved} notes, ${errors} errors`)

      // Broadcast to all windows that notes have changed so panels refresh
      if (saved > 0) {
        broadcastNotesChanged()
      }

      return { saved, errors, ids, savedNotes }
    }
  )

  console.log('[Import] IPC handlers registered')
}
