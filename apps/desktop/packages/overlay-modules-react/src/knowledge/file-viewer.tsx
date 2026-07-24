'use client'

import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Music, FileQuestion, Download, ExternalLink, FolderSearch, Loader2, FileType } from 'lucide-react'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '../shell'
import { FileTypeIcon } from '../shared/file-type-icon'

import {
  FILE_VIEWER_HTML_SANDBOX,
  getFileType,
  isEditableType,
  isPreviewableType,
  prefersUrlPreview,
  resolveSafeViewerUrl,
  type FileViewerType,
} from '@overlay/app-core/file-viewer'

export interface FileViewerAsset {
  name: string
  url?: string
}

export interface FileViewerOperations {
  download?: (asset: FileViewerAsset) => void | Promise<void>
  openExternal?: (asset: FileViewerAsset) => void | Promise<void>
  revealLocal?: (asset: FileViewerAsset) => void | Promise<void>
}

export interface FileViewerProps {
  name: string
  content: string
  url?: string
  operations?: FileViewerOperations
}

function previewSource(name: string, content: string, url?: string): string {
  const trimmedUrl = url?.trim() ?? ''
  if (prefersUrlPreview(name) && trimmedUrl) {
    return trimmedUrl
  }
  return content.trim() || trimmedUrl
}

export const DOCX_SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'style'],
}

export type { FileViewerType }
export { getFileType, isEditableType, isPreviewableType }

/** Read a File object as the right content string (text or base64 data URL) */
export async function readFileAsContent(file: File): Promise<string> {
  const type = getFileType(file.name)
  if (type === 'text' || type === 'html' || type === 'markdown' || type === 'csv') {
    return file.text()
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ─── CSV renderer ─────────────────────────────────────────────────────────────

/** RFC 4180-style: commas/newlines inside `"..."` stay in one cell. */
function parseCSV(raw: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQ = false
  const s = raw.replace(/^\uFEFF/, '')

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQ = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQ = true
    } else if (ch === ',') {
      row.push(cur)
      cur = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(cur)
      cur = ''
      if (row.some((c) => c.length > 0) || row.length > 1) {
        rows.push(row)
      }
      row = []
    } else {
      cur += ch
    }
  }
  row.push(cur)
  if (row.some((c) => c.length > 0) || row.length > 1) {
    rows.push(row)
  }
  return rows
}

const proseMarkdown =
  'prose prose-sm max-w-2xl text-[var(--foreground)] prose-headings:font-semibold prose-headings:text-[var(--foreground)] prose-p:text-[var(--foreground)] prose-li:text-[var(--foreground)] prose-strong:text-[var(--foreground)] prose-a:text-blue-600 dark:prose-a:text-sky-400 prose-code:rounded prose-code:bg-[var(--surface-subtle)] prose-code:px-1 prose-code:text-[var(--foreground)] prose-pre:bg-[var(--surface-subtle)] prose-pre:text-[var(--foreground)] prose-blockquote:border-[var(--border)] prose-blockquote:text-[var(--muted)]'

// ─── Async binary viewers ─────────────────────────────────────────────────────

function DocumentViewer({ url }: { url: string }) {
  const [html, setHtml] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fetch(url, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load (${r.status})`)
        return r.arrayBuffer()
      })
      .then(async (buf) => {
        const mammoth = await import('mammoth')
        const DOMPurify = (await import('dompurify')).default
        const result = await mammoth.convertToHtml({ arrayBuffer: buf })
        if (!cancelled) {
          setHtml(DOMPurify.sanitize(result.value, DOCX_SANITIZE_CONFIG))
          setLoading(false)
        }
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [url])

  if (loading) {
    return (
      <div className="overlay-file-viewer overlay-file-viewer--document flex flex-1 flex-col items-center justify-center gap-3 p-8 text-[var(--muted)]">
        <Loader2 size={24} className="animate-spin" />
        <p className="text-xs">Loading document…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="overlay-file-viewer overlay-file-viewer--document flex flex-1 flex-col items-center justify-center gap-3 p-8 text-[var(--muted)]">
        <FileType size={28} />
        <p className="text-sm font-medium text-[var(--foreground)]">Could not load document</p>
        <p className="text-xs text-red-500">{error}</p>
      </div>
    )
  }

  return (
    <div className="overlay-file-viewer overlay-file-viewer--document flex-1 overflow-y-auto px-8 py-6">
      <div
        className="prose prose-sm max-w-3xl text-[var(--foreground)] prose-headings:font-semibold prose-headings:text-[var(--foreground)] prose-p:text-[var(--foreground)] prose-li:text-[var(--foreground)] prose-strong:text-[var(--foreground)] prose-a:text-blue-600 dark:prose-a:text-sky-400 prose-code:rounded prose-code:bg-[var(--surface-subtle)] prose-code:px-1 prose-code:text-[var(--foreground)] prose-pre:bg-[var(--surface-subtle)] prose-pre:text-[var(--foreground)] prose-blockquote:border-[var(--border)] prose-blockquote:text-[var(--muted)]"
        dangerouslySetInnerHTML={{ __html: html ?? '' }}
      />
    </div>
  )
}

// ─── FileViewer ───────────────────────────────────────────────────────────────

function ViewerOperationButtons({
  name,
  url,
  operations,
}: FileViewerAsset & { operations?: FileViewerOperations }) {
  const downloadUrl = resolveSafeViewerUrl(url, 'download')
  const externalUrl = resolveSafeViewerUrl(url, 'external')
  if (!operations && !downloadUrl) return null
  const asset = { name, url: downloadUrl }
  const buttonClass = 'inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--surface-subtle)]'

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {operations?.download ? (
        <button type="button" className={buttonClass} onClick={() => void operations.download?.(asset)}>
          <Download size={12} /> Download
        </button>
      ) : downloadUrl ? (
        <a href={downloadUrl} download={name} className={buttonClass}>
          <Download size={12} /> Download
        </a>
      ) : null}
      {operations?.openExternal && externalUrl ? (
        <button type="button" className={buttonClass} onClick={() => void operations.openExternal?.({ name, url: externalUrl })}>
          <ExternalLink size={12} /> Open externally
        </button>
      ) : null}
      {operations?.revealLocal ? (
        <button type="button" className={buttonClass} onClick={() => void operations.revealLocal?.(asset)}>
          <FolderSearch size={12} /> Show locally
        </button>
      ) : null}
    </div>
  )
}

export function FileViewer({ name, content, url, operations }: FileViewerProps) {
  const type = getFileType(name)
  const source = previewSource(name, content, url)

  if (type === 'markdown') {
    return (
      <div className="overlay-file-viewer overlay-file-viewer--markdown flex-1 overflow-y-auto px-8 py-6">
        <div className={proseMarkdown}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </div>
    )
  }

  if (type === 'text') {
    return (
      <div className="overlay-file-viewer overlay-file-viewer--text flex-1 overflow-y-auto px-8 py-6">
        <pre className="text-sm leading-relaxed font-mono whitespace-pre-wrap text-[var(--foreground)]">
          {content}
        </pre>
      </div>
    )
  }

  if (type === 'html') {
    return (
      <div className="overlay-file-viewer overlay-file-viewer--html flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
        <iframe
          srcDoc={source}
          sandbox={FILE_VIEWER_HTML_SANDBOX}
          referrerPolicy="no-referrer"
          className="min-h-0 flex-1 w-full border-none bg-white"
          title={name}
        />
      </div>
    )
  }

  if (type === 'csv') {
    const rows = parseCSV(content)
    const headers = rows[0] ?? []
    const body = rows.slice(1)
    return (
      <div className="overlay-file-viewer overlay-file-viewer--csv flex-1 overflow-auto px-4 py-4">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th
                  key={i}
                  className="whitespace-nowrap border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-left font-medium text-[var(--foreground)]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? '' : 'bg-[var(--surface-subtle)]/50'}>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className="max-w-md whitespace-pre-wrap break-words border border-[var(--border)] px-3 py-1.5 align-top text-[var(--muted)]"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (type === 'image') {
    const mediaUrl = resolveSafeViewerUrl(source, 'media')
    if (!mediaUrl) return <UnavailablePreview name={name} />
    return (
      <div className="overlay-file-viewer overlay-file-viewer--image flex flex-1 items-center justify-center overflow-auto bg-[var(--surface-subtle)] p-8">
        {/* Shared web/Electron viewer; Next's image runtime is intentionally unavailable here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mediaUrl} alt={name} className="max-h-full max-w-full rounded-lg object-contain shadow-sm" />
      </div>
    )
  }

  if (type === 'audio') {
    const mediaUrl = resolveSafeViewerUrl(source, 'media')
    if (!mediaUrl) return <UnavailablePreview name={name} />
    return (
      <div className="overlay-file-viewer overlay-file-viewer--audio flex flex-1 flex-col items-center justify-center gap-6 p-8">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--surface-subtle)]">
          <Music size={28} className="text-[var(--muted)]" />
        </div>
        <p className="text-sm font-medium text-[var(--foreground)]">{name}</p>
        <audio controls src={mediaUrl} className="w-full max-w-lg" />
      </div>
    )
  }

  if (type === 'video') {
    const mediaUrl = resolveSafeViewerUrl(source, 'media')
    if (!mediaUrl) return <UnavailablePreview name={name} />
    return (
      <div className="overlay-file-viewer overlay-file-viewer--video flex flex-1 items-center justify-center overflow-hidden bg-black p-4">
        <video controls src={mediaUrl} className="max-h-full max-w-full" />
      </div>
    )
  }

  if (type === 'pdf') {
    const iframeSrc = resolveSafeViewerUrl(source, 'pdf')
    if (iframeSrc) {
      return (
        <div className="overlay-file-viewer overlay-file-viewer--pdf flex min-h-0 flex-1 flex-col overflow-hidden">
          <iframe src={iframeSrc} sandbox="" referrerPolicy="no-referrer" className="min-h-0 flex-1 w-full border-none" title={name} />
        </div>
      )
    }
    if (content.trim()) {
      return (
        <div className="overlay-file-viewer overlay-file-viewer--pdf flex-1 overflow-y-auto px-8 py-6">
          <p className="mb-4 max-w-2xl text-xs text-[var(--muted)]">
            This PDF is stored as extracted text for search and the notebook (not the original layout).
          </p>
          <pre className="max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-[var(--foreground)]">
            {content}
          </pre>
        </div>
      )
    }
    return (
      <div className="overlay-file-viewer overlay-file-viewer--pdf flex flex-1 flex-col items-center justify-center gap-3 p-8 text-[var(--muted)]">
        <FileType size={28} />
        <p className="text-sm font-medium text-[var(--foreground)]">Could not load PDF preview</p>
      </div>
    )
  }

  if (type === 'document') {
    const documentUrl = resolveSafeViewerUrl(url, 'document')
    if (documentUrl) return <DocumentViewer url={documentUrl} />
  }

  // binary fallback
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const labels: Record<string, string> = {
    docx: 'Word Document', doc: 'Word Document',
    xlsx: 'Excel Spreadsheet', xls: 'Excel Spreadsheet',
    pptx: 'PowerPoint Presentation', ppt: 'PowerPoint Presentation',
    epub: 'EPUB Book',
    zip: 'ZIP Archive', gz: 'GZip Archive', tar: 'TAR Archive',
  }
  const downloadUrl = resolveSafeViewerUrl(url, 'download')
    ?? resolveSafeViewerUrl(content, 'download')

  return (
    <div className="overlay-file-viewer overlay-file-viewer--binary flex flex-1 flex-col items-center justify-center gap-4 p-8 text-[var(--muted)]">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--surface-subtle)]">
        {labels[ext] ? (
          <FileTypeIcon file={{ name, extension: ext }} size={30} framed />
        ) : (
          <FileQuestion size={28} className="text-[var(--muted)]" />
        )}
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-[var(--foreground)]">{name}</p>
        <p className="mt-1 text-xs text-[var(--muted-light)]">{labels[ext] ?? 'Binary file'} — preview not available</p>
      </div>
      <ViewerOperationButtons name={name} url={downloadUrl} operations={operations} />
    </div>
  )
}

function UnavailablePreview({ name }: { name: string }) {
  return (
    <div className="overlay-file-viewer overlay-file-viewer--unavailable flex flex-1 flex-col items-center justify-center gap-3 p-8 text-[var(--muted)]">
      <FileQuestion size={28} />
      <p className="text-sm font-medium text-[var(--foreground)]">Could not safely preview {name}</p>
    </div>
  )
}

// ─── Standalone file viewer with header (for project/knowledge views) ─────────

export function FileViewerPanel({
  name,
  previewName,
  content,
  url,
  isSaving,
  isEditable,
  onContentChange,
  headerLeft,
  headerRight,
  operations,
}: {
  name: string
  /** Optional classification name when the displayed file name differs from its preview payload. */
  previewName?: string
  content: string
  url?: string
  isSaving?: boolean
  isEditable?: boolean
  onContentChange?: (val: string) => void
  headerLeft?: React.ReactNode
  headerRight?: React.ReactNode
  operations?: FileViewerOperations
}) {
  const type = getFileType(name)
  const editable = isEditable && (type === 'text' || type === 'html' || type === 'markdown') && onContentChange

  return (
    <AppScreenShell
      className="overlay-file-viewer-panel flex min-h-0 flex-1 flex-col"
      header={
        <AppScreenHeader className="px-6">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {headerLeft}
              <span className="truncate text-sm font-medium text-[var(--foreground)]">{name}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isSaving ? (
                <span className="flex shrink-0 items-center gap-1 text-xs text-[var(--muted-light)]">Saving...</span>
              ) : null}
              <ViewerOperationButtons name={name} url={url} operations={operations} />
              {headerRight}
            </div>
          </div>
        </AppScreenHeader>
      }
    >
      <AppScreenBody padding="none" maxWidth="none" scroll="hidden" className="flex h-full flex-col">
      {editable ? (
        <>
          <textarea
            value={content}
            onChange={(e) => onContentChange(e.target.value)}
            placeholder="Start typing..."
            className="min-h-0 flex-1 resize-none bg-[var(--background)] px-8 py-6 font-mono text-sm leading-relaxed text-[var(--foreground)] outline-none placeholder:text-[var(--muted-light)]"
          />
          <div className="shrink-0 border-t border-[var(--border)] px-8 py-2 text-[11px] text-[var(--muted-light)]">
            Reference in chat with{' '}
            <code className="rounded bg-[var(--surface-subtle)] px-1 py-0.5 font-mono text-[var(--foreground)]">
              @{name}
            </code>
          </div>
        </>
      ) : (
        <FileViewer name={previewName ?? name} content={content} url={url} operations={operations} />
      )}
      </AppScreenBody>
    </AppScreenShell>
  )
}

export interface OutputViewerProps {
  name: string
  content?: string
  url?: string
  mimeType?: string
  outputType?: string
  modelId?: string
  prompt?: string
  createdAt?: number
  headerLeft?: React.ReactNode
  operations?: FileViewerOperations
}

function formatOutputDate(timestamp?: number): string {
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Canonical generated-output presentation used by web and Electron hosts. */
export function OutputViewer({
  name,
  content = '',
  url,
  mimeType,
  outputType,
  modelId,
  prompt,
  createdAt,
  headerLeft,
  operations,
}: OutputViewerProps) {
  const metadata = [modelId, outputType || mimeType, formatOutputDate(createdAt)].filter(Boolean)
  const safeDownloadUrl = resolveSafeViewerUrl(url, 'download')

  return (
    <AppScreenShell
      className="overlay-output-viewer flex min-h-0 flex-1 flex-col"
      header={(
        <AppScreenHeader className="px-4">
          <div className="flex min-w-0 items-center gap-2">
            {headerLeft}
            <FileTypeIcon file={{ name, mimeType, extension: name.split('.').pop() }} size={16} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--foreground)]">{name || 'Output'}</span>
            <ViewerOperationButtons name={name || 'output'} url={safeDownloadUrl} operations={operations} />
          </div>
        </AppScreenHeader>
      )}
    >
      <AppScreenBody padding="none" maxWidth="none" scroll="hidden" className="flex min-h-0 flex-1 flex-col">
        {(metadata.length > 0 || prompt) ? (
          <div className="shrink-0 border-b border-[var(--border)] px-6 py-3">
            {metadata.length > 0 ? (
              <p className="text-xs text-[var(--muted-light)]">{metadata.join(' / ')}</p>
            ) : null}
            {prompt ? <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--muted)]">{prompt}</p> : null}
          </div>
        ) : null}
        <FileViewer name={name} content={content} url={url} operations={operations} />
      </AppScreenBody>
    </AppScreenShell>
  )
}
