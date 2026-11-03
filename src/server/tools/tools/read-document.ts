import 'server-only'

import { randomUUID } from 'node:crypto'
import { posix as path } from 'node:path'
import type { SandboxInstance } from '@overlay/sandbox-runtime'
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

type AuthorizedComputer = Extract<Awaited<ReturnType<typeof computerInstanceFor>>, { ok: true }>
type ReaderOutput = Record<string, unknown>
type ReaderResult = { output: ReaderOutput } | { error: string }

async function readAuthorizedPdf(
  options: OverlayToolsOptions,
  input: { fileId: string; revision?: string; mode: ReadMode; page: number },
): Promise<{ revision: string; bytes: Uint8Array } | { error: string }> {
  const metadataResponse = await callInternalApiGet(
    `/api/v1/files?fileId=${encodeURIComponent(input.fileId)}`,
    options.accessToken,
    options.baseUrl,
    options.forwardCookie,
    options.serverSecret,
    options.userId,
    options.workspaceId,
  )
  if (!metadataResponse.ok) return { error: 'File is not available to this conversation.' }
  const metadata = await metadataResponse.json() as {
    name: string; mimeType?: string
  }
  if (options.sharedRoom) return { error: 'Original-file reading is unavailable in shared rooms.' }
  const original = await fileService.readOriginalFile({
    fileId: input.fileId, userId: options.userId, workspaceId: options.workspaceId,
  }).catch((_error) => null)
  if (!original || original.sizeBytes > MAX_SOURCE_BYTES) {
    return { error: 'Original file is unavailable or exceeds the 100 MiB reading limit.' }
  }
  const revision = original.revision
  if (input.revision && input.revision !== revision) {
    return { error: 'Source revision mismatch; refresh file metadata before reading.' }
  }
  const mimeType = (metadata.mimeType ?? '').toLowerCase()
  if (mimeType !== 'application/pdf' && !metadata.name.toLowerCase().endsWith('.pdf')) {
    return { error: 'Original page reading currently requires a PDF; use read_file for extracted text.' }
  }
  return { revision, bytes: original.bytes }
}

function readerPaths() {
  const workdir = path.join('/tmp', `overlay-document-reader-${randomUUID()}`)
  const environmentPath = '/tmp/overlay-document-reader-1.26.7/venv'
  return {
    workdir,
    sourcePath: path.join(workdir, 'source.pdf'),
    programPath: path.join(workdir, 'reader.py'),
    imagePath: path.join(workdir, 'page.png'),
    environmentPath,
    pythonPath: path.join(environmentPath, 'bin', 'python'),
  }
}

async function prepareReaderEnvironment(instance: SandboxInstance, environmentPath: string): Promise<string | null> {
  const mkdir = await instance.runCommand({
    command: 'mkdir',
    args: ['-p', path.dirname(environmentPath)],
    timeoutMs: 10_000,
  })
  if ((await mkdir.wait()).exitCode !== 0) return 'Document reader directory is unavailable.'
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
  const result = await setup.wait()
  return result.exitCode === 0
    ? null
    : result.stderr.slice(0, 1000) || 'Document reader setup is unavailable.'
}

async function ensureOcrCapability(instance: SandboxInstance): Promise<string | null> {
  const ocr = await instance.runCommand({
    command: 'sh',
    args: ['-c', 'command -v tesseract >/dev/null 2>&1 || (command -v sudo >/dev/null 2>&1 && sudo -n apt-get install -y tesseract-ocr)'],
    timeoutMs: 60_000,
  })
  return (await ocr.wait()).exitCode === 0
    ? null
    : 'OCR requires Tesseract on this Computer. Use render for visual inspection or install Tesseract.'
}

function parseReaderOutput(stdout: string, stderr: string, exitCode: number): ReaderResult {
  const parsed = stdout.trim().split(/\r?\n/).reverse()
    .map(line => {
      try { return JSON.parse(line) as ReaderOutput } catch (_error) { return null }
    })
    .find((value): value is ReaderOutput => value !== null && typeof value === 'object'
      && !Array.isArray(value) && ('pageCount' in value || 'error' in value))
  if (!parsed) return { error: stderr.slice(0, 1000) || 'Document reader returned invalid output.' }
  if (typeof parsed.error === 'string') return { error: `${parsed.error}: ${String(parsed.message ?? '').slice(0, 500)}` }
  if (exitCode !== 0) return { error: 'Document reader failed before completing the requested page.' }
  return { output: parsed }
}

async function runReaderProgram(
  instance: SandboxInstance,
  input: { page: number; mode: ReadMode },
  paths: ReturnType<typeof readerPaths>,
): Promise<ReaderResult> {
  const handle = await instance.runCommand({
    command: paths.pythonPath,
    args: [paths.programPath, paths.sourcePath, paths.imagePath, String(input.page), input.mode],
    cwd: paths.workdir,
    timeoutMs: 60_000,
  })
  const result = await handle.wait()
  return parseReaderOutput(result.stdout, result.stderr, result.exitCode)
}

async function operateReader(
  computer: AuthorizedComputer,
  bytes: Uint8Array,
  input: { page: number; mode: ReadMode },
  paths: ReturnType<typeof readerPaths>,
): Promise<ReaderResult> {
  return computer.operate(async instance => {
    const mkdir = await instance.runCommand({
      command: 'mkdir',
      args: ['-p', paths.workdir, path.dirname(paths.environmentPath)],
      timeoutMs: 10_000,
    })
    if ((await mkdir.wait()).exitCode !== 0) return { error: 'Document reader directory is unavailable.' }
    await instance.writeFiles([
      { path: paths.sourcePath, contents: bytes },
      { path: paths.programPath, contents: new TextEncoder().encode(DOCUMENT_READER_PROGRAM) },
    ])
    const setupError = await prepareReaderEnvironment(instance, paths.environmentPath)
    if (setupError) return { error: setupError }
    if (input.mode === 'ocr') {
      const ocrError = await ensureOcrCapability(instance)
      if (ocrError) return { error: ocrError }
    }
    return runReaderProgram(instance, input, paths)
  }, PREPARE_TIMEOUT_MS)
}

async function readRenderedImage(computer: AuthorizedComputer, imagePath: string): Promise<Uint8Array | undefined> {
  return await computer.operate(instance => instance.readFile(imagePath), 30_000) ?? undefined
}

async function cleanupReaderDirectory(computer: AuthorizedComputer, workdir: string): Promise<void> {
  await computer.operate(async instance => {
    const cleanup = await instance.runCommand({ command: 'rm', args: ['-rf', workdir], timeoutMs: 10_000 })
    await cleanup.wait()
  }, 10_000).catch((_error) => undefined)
}

function successfulReadDocumentResult(
  fileId: string,
  revision: string,
  mode: ReadMode,
  output: ReaderOutput,
  image?: Uint8Array,
): ReadDocumentResult {
  return {
    success: true,
    fileId,
    revision,
    page: output.page,
    pageCount: output.pageCount,
    mode,
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
  }
}

export async function executeReadDocument(
  options: OverlayToolsOptions,
  input: { fileId: string; revision?: string; mode: ReadMode; page: number },
): Promise<ReadDocumentResult> {
  const source = await readAuthorizedPdf(options, input)
  if ('error' in source) return { success: false, error: source.error }
  const computer = await computerInstanceFor(options)
  if (!computer.ok) return { success: false, error: String(computer.error) }

  const paths = readerPaths()
  try {
    const result = await operateReader(computer, source.bytes, input, paths)
    if ('error' in result) return { success: false, error: result.error }
    const image = input.mode === 'render' || input.mode === 'ocr'
      ? await readRenderedImage(computer, paths.imagePath)
      : undefined
    if ((input.mode === 'render' || input.mode === 'ocr') && (!image || image.byteLength > MAX_IMAGE_BYTES)) {
      return { success: false, error: 'Rendered page image is unavailable or exceeds 8 MiB.' }
    }
    return successfulReadDocumentResult(input.fileId, source.revision, input.mode, result.output, image)
  } finally {
    await cleanupReaderDirectory(computer, paths.workdir)
  }
}
