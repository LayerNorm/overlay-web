import 'server-only'

import { randomUUID } from 'node:crypto'
import { posix as path } from 'node:path'
import { DOCUMENT_READER_PROGRAM } from '@/server/files/document-reader-program'
import { fileService } from '@/server/files/http'
import { computerInstanceFor } from './overlay-executes'
import { callInternalApiGet } from './internal-api'
import type { OverlayToolsOptions } from './types'

const MAX_SOURCE_BYTES = 100 * 1024 * 1024
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const PREPARE_TIMEOUT_MS = 120_000

type ReadMode = 'metadata' | 'text' | 'render' | 'tables' | 'ocr'
type ReadDocumentResult = {
  success: false
  error: string
} | {
  success: true
  fileId: string
  revision: string
  page?: unknown
  pageCount?: unknown
  mode: ReadMode
  text?: string
  tables?: unknown[]
  truncated?: boolean
  requiresVerification?: boolean
  needsVisualInspection?: boolean
  width?: number
  height?: number
  image?: Uint8Array
  imageMediaType?: string
}

export async function executeReadDocument(
  options: OverlayToolsOptions,
  input: { fileId: string; revision?: string; mode: ReadMode; page: number },
): Promise<ReadDocumentResult> {
  const metadataResponse = await callInternalApiGet(
    `/api/v1/files?fileId=${encodeURIComponent(input.fileId)}`,
    options.accessToken,
    options.baseUrl,
    options.forwardCookie,
    options.serverSecret,
    options.userId,
    options.workspaceId,
  )
  if (!metadataResponse.ok) return { success: false, error: 'File is not available to this conversation.' }
  const metadata = await metadataResponse.json() as {
    _id: string; name: string; mimeType?: string; sizeBytes?: number; sourceChecksumSha256?: string
  }
  if (options.sharedRoom) return { success: false, error: 'Original-file reading is unavailable in shared rooms.' }
  const original = await fileService.readOriginalFile({
    fileId: input.fileId, userId: options.userId, workspaceId: options.workspaceId,
  }).catch((_error) => null)
  if (!original || original.sizeBytes > MAX_SOURCE_BYTES) {
    return { success: false, error: 'Original file is unavailable or exceeds the 100 MiB reading limit.' }
  }
  const revision = original.revision
  if (input.revision && input.revision !== revision) {
    return { success: false, error: 'Source revision mismatch; refresh file metadata before reading.' }
  }
  const mimeType = (metadata.mimeType ?? '').toLowerCase()
  if (mimeType !== 'application/pdf' && !metadata.name.toLowerCase().endsWith('.pdf')) {
    return { success: false, error: 'Original page reading currently requires a PDF; use read_file for extracted text.' }
  }
  const bytes = original.bytes
  const computer = await computerInstanceFor(options)
  if (!computer.ok) return { success: false, error: String(computer.error) }

  const workdir = path.join('/tmp', `overlay-document-reader-${randomUUID()}`)
  const sourcePath = path.join(workdir, 'source.pdf')
  const programPath = path.join(workdir, 'reader.py')
  const imagePath = path.join(workdir, 'page.png')
  const environmentPath = '/tmp/overlay-document-reader-1.26.7/venv'
  const pythonPath = path.join(environmentPath, 'bin', 'python')
  let output: Record<string, unknown> | null = null
  let image: Uint8Array | undefined
  try {
    const result = await computer.operate(async instance => {
      const mkdir = await instance.runCommand({ command: 'mkdir', args: ['-p', workdir, path.dirname(environmentPath)], timeoutMs: 10_000 })
      if ((await mkdir.wait()).exitCode !== 0) return { error: 'Document reader directory is unavailable.' }
      await instance.writeFiles([
        { path: sourcePath, contents: bytes },
        { path: programPath, contents: new TextEncoder().encode(DOCUMENT_READER_PROGRAM) },
      ])
      const setup = await instance.runCommand({
        command: 'flock',
        args: [
          '-x', '/tmp/overlay-document-reader-1.26.7/setup.lock',
          'sh', '-c',
          'set -eu; venv="$1"; marker="$venv/.ready-1.26.7"; mkdir -p "$(dirname "$venv")"; if [ ! -f "$marker" ]; then python3 -m venv "$venv"; "$venv/bin/python" -m pip install -q --disable-pip-version-check --no-input pymupdf==1.26.7; "$venv/bin/python" -c "import pymupdf; assert pymupdf.VersionBind == \\"1.26.7\\""; touch "$marker"; fi',
          'document-reader-setup', environmentPath,
        ],
        timeoutMs: PREPARE_TIMEOUT_MS,
      })
      const setupResult = await setup.wait()
      if (setupResult.exitCode !== 0) {
        return { error: setupResult.stderr.slice(0, 1000) || 'Document reader setup is unavailable.' }
      }
      if (input.mode === 'ocr') {
        const ocr = await instance.runCommand({
          command: 'sh', args: ['-c', 'command -v tesseract >/dev/null 2>&1 || (command -v sudo >/dev/null 2>&1 && sudo -n apt-get install -y tesseract-ocr)'],
          timeoutMs: 60_000,
        })
        if ((await ocr.wait()).exitCode !== 0) return { error: 'OCR requires Tesseract on this Computer. Use render for visual inspection or install Tesseract.' }
      }
      const handle = await instance.runCommand({
        command: pythonPath,
        args: [programPath, sourcePath, imagePath, String(input.page), input.mode],
        cwd: workdir,
        timeoutMs: 60_000,
      })
      const commandResult = await handle.wait()
      try {
        const parsed = commandResult.stdout.trim().split(/\r?\n/).reverse()
          .map(line => {
            try { return JSON.parse(line) as Record<string, unknown> } catch (_error) { return null }
          })
          .find((value): value is Record<string, unknown> => value !== null && typeof value === 'object'
            && !Array.isArray(value) && ('pageCount' in value || 'error' in value))
        if (!parsed) return { error: commandResult.stderr.slice(0, 1000) || 'Document reader returned invalid output.' }
        if (typeof parsed.error === 'string') return { error: `${parsed.error}: ${String(parsed.message ?? '').slice(0, 500)}` }
        if (commandResult.exitCode !== 0) return { error: 'Document reader failed before completing the requested page.' }
        return parsed
      } catch (_error) {
        return { error: 'Document reader returned invalid output.' }
      }
    }, PREPARE_TIMEOUT_MS)
    if ('error' in result) return { success: false, error: String(result.error) }
    output = result
    if (input.mode === 'render' || input.mode === 'ocr') {
      image = await computer.operate(instance => instance.readFile(imagePath), 30_000) ?? undefined
      if (!image || image.byteLength > MAX_IMAGE_BYTES) {
        return { success: false, error: 'Rendered page image is unavailable or exceeds 8 MiB.' }
      }
    }
    return {
      success: true,
      fileId: input.fileId,
      revision,
      page: output.page,
      pageCount: output.pageCount,
      mode: input.mode,
      ...(typeof output.text === 'string' ? { text: output.text } : {}),
      ...(Array.isArray(output.tables) ? { tables: output.tables } : {}),
      ...(output.truncated === true ? { truncated: true } : {}),
      ...(output.requiresVerification === true ? { requiresVerification: true } : {}),
      ...(output.needsVisualInspection === true ? { needsVisualInspection: true } : {}),
      ...(typeof output.width === 'number' ? { width: output.width } : {}),
      ...(typeof output.height === 'number' ? { height: output.height } : {}),
      ...(typeof output.imageWidth === 'number' ? { imageWidth: output.imageWidth } : {}),
      ...(typeof output.imageHeight === 'number' ? { imageHeight: output.imageHeight } : {}),
      ...(image ? { image, imageMediaType: 'image/png' } : {}),
      ...(typeof output.error === 'string' ? { error: output.error } : {}),
    }
  } finally {
    await computer.operate(async instance => {
      const cleanup = await instance.runCommand({ command: 'rm', args: ['-rf', workdir], timeoutMs: 10_000 })
      await cleanup.wait()
    }, 10_000).catch((_error) => undefined)
  }
}
