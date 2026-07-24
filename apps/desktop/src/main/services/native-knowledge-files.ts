import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, relative, resolve } from 'node:path'

export interface NativeKnowledgePickedFile {
  token: string
  name: string
  sizeBytes: number
  mimeType: string
  relativePath?: string
}

const MAX_PICKED_FILES = 5_000
const MAX_PICKED_FILE_BYTES = 512 * 1024 * 1024

function safeName(value: string): string {
  return basename(value).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 180) || 'download'
}

function mimeType(name: string): string {
  const values: Record<string, string> = {
    '.csv': 'text/csv', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.gif': 'image/gif', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.md': 'text/markdown',
    '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.pdf': 'application/pdf',
    '.png': 'image/png', '.txt': 'text/plain', '.wav': 'audio/wav', '.webm': 'video/webm',
    '.webp': 'image/webp', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
  return values[extname(name).toLowerCase()] ?? 'application/octet-stream'
}

export class NativeKnowledgeFileStore {
  private readonly selected = new Map<string, string>()
  private readonly cacheRoot: string

  constructor(userDataRoot: string) {
    this.cacheRoot = resolve(userDataRoot, 'knowledge-file-cache', 'v1')
  }

  registerSelection(paths: readonly string[], directoryRoot?: string): NativeKnowledgePickedFile[] {
    const files: string[] = []
    for (const input of paths) {
      const path = resolve(input)
      if (!existsSync(path) || lstatSync(path).isSymbolicLink()) continue
      if (statSync(path).isDirectory()) this.walk(path, files)
      else files.push(path)
      if (files.length > MAX_PICKED_FILES) throw new Error('Too many files selected')
    }
    return files.map((path) => {
      const stats = statSync(path)
      if (stats.size > MAX_PICKED_FILE_BYTES) throw new Error(`${basename(path)} exceeds the desktop upload limit`)
      const token = randomUUID()
      this.selected.set(token, path)
      return {
        token,
        name: basename(path),
        sizeBytes: stats.size,
        mimeType: mimeType(path),
        relativePath: directoryRoot ? relative(resolve(directoryRoot), path).split('\\').join('/') : undefined,
      }
    })
  }

  readSelection(token: string): { dataBase64: string } {
    const path = this.selected.get(token)
    if (!path || !existsSync(path) || !statSync(path).isFile()) {
      throw new Error('The selected file token is invalid or expired')
    }
    this.selected.delete(token)
    return { dataBase64: readFileSync(path).toString('base64') }
  }

  cacheDownloadedFile(name: string, dataBase64: string): string {
    if (dataBase64.length > Math.ceil(MAX_PICKED_FILE_BYTES * 4 / 3) + 4) {
      throw new Error('The downloaded file exceeds the desktop cache limit')
    }
    const bytes = Buffer.from(dataBase64, 'base64')
    if (bytes.byteLength > MAX_PICKED_FILE_BYTES) {
      throw new Error('The downloaded file exceeds the desktop cache limit')
    }
    mkdirSync(this.cacheRoot, { recursive: true })
    const path = resolve(this.cacheRoot, `${Date.now()}-${safeName(name)}`)
    if (!path.startsWith(`${this.cacheRoot}/`)) throw new Error('Invalid cache path')
    writeFileSync(path, bytes, { mode: 0o600 })
    return path
  }

  private walk(directory: string, files: string[]): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) this.walk(path, files)
      else if (entry.isFile()) files.push(path)
      if (files.length > MAX_PICKED_FILES) throw new Error('Too many files selected')
    }
  }
}
