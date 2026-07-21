'use client'

import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Music, FileQuestion, Download, Loader2, FileType } from 'lucide-react'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '../shell'
import { FileTypeIcon } from '../shared/file-type-icon'

import {
  getFileType,
  isEditableType,
  isPreviewableType,
  prefersUrlPreview,
  type FileViewerType,
} from '@overlay/app-core/file-viewer'

function safeHttpUrl(value?: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function previewSource(name: string, content: string, url?: string): string {
  const trimmedUrl = url?.trim() ?? ''
  if (prefersUrlPreview(name) && trimmedUrl) {
    return trimmedUrl
  }
  return content.trim() || trimmedUrl
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
    setLoading(true)
    setError(null)
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load (${r.status})`)
        return r.arrayBuffer()
      })
      .then(async (buf) => {
        const mammoth = await import('mammoth')
        const DOMPurify = (await import('dompurify')).default
        const result = await mammoth.convertToHtml({ arrayBuffer: buf })
        if (!cancelled) {
          setHtml(DOMPurify.sanitize(result.value, {
            USE_PROFILES: { html: true },
            FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
            FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'style'],
          }))
          setLoading(false)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setLoading(false)
        }
      })
    return () => { cancelled = true }
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

export function FileViewer({ name, content, url }: { name: string; content: string; url?: string }) {
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
          sandbox="allow-scripts allow-forms allow-pointer-lock allow-modals"
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
    return (
      <div className="overlay-file-viewer overlay-file-viewer--image flex flex-1 items-center justify-center overflow-auto bg-[var(--surface-subtle)] p-8">
        {/* Shared web/Electron viewer; Next's image runtime is intentionally unavailable here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={source} alt={name} className="max-h-full max-w-full rounded-lg object-contain shadow-sm" />
      </div>
    )
  }

  if (type === 'audio') {
    return (
      <div className="overlay-file-viewer overlay-file-viewer--audio flex flex-1 flex-col items-center justify-center gap-6 p-8">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--surface-subtle)]">
          <Music size={28} className="text-[var(--muted)]" />
        </div>
        <p className="text-sm font-medium text-[var(--foreground)]">{name}</p>
        <audio controls src={source} className="w-full max-w-lg" />
      </div>
    )
  }

  if (type === 'video') {
    return (
      <div className="overlay-file-viewer overlay-file-viewer--video flex flex-1 items-center justify-center overflow-hidden bg-black p-4">
        <video controls src={source} className="max-h-full max-w-full" />
      </div>
    )
  }

  if (type === 'pdf') {
    const iframeSrc = source.trim()
    const canEmbed =
      iframeSrc.startsWith('http://') ||
      iframeSrc.startsWith('https://') ||
      iframeSrc.startsWith('data:') ||
      iframeSrc.startsWith('blob:') ||
      iframeSrc.startsWith('/api/')
    if (canEmbed) {
      return (
        <div className="overlay-file-viewer overlay-file-viewer--pdf flex min-h-0 flex-1 flex-col overflow-hidden">
          <iframe src={iframeSrc} className="min-h-0 flex-1 w-full border-none" title={name} />
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

  if (type === 'document' && url) {
    return <DocumentViewer url={url} />
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
  const downloadUrl = safeHttpUrl(url)
    || (url?.startsWith('/api/') || url?.startsWith('blob:') ? url : undefined)
    || (content.startsWith('/api/') ? content : undefined)

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
      {downloadUrl && (
        <a
          href={downloadUrl}
          download={name}
          className="flex items-center gap-1.5 rounded-md bg-[var(--foreground)] px-3 py-1.5 text-xs text-[var(--background)] transition-opacity hover:opacity-90"
        >
          <Download size={12} />
          Download
        </a>
      )}
    </div>
  )
}

// ─── Standalone file viewer with header (for project/knowledge views) ─────────

export function FileViewerPanel({
  name,
  content,
  url,
  isSaving,
  isEditable,
  onContentChange,
  headerLeft,
  headerRight,
}: {
  name: string
  content: string
  url?: string
  isSaving?: boolean
  isEditable?: boolean
  onContentChange?: (val: string) => void
  headerLeft?: React.ReactNode
  headerRight?: React.ReactNode
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
        <FileViewer name={name} content={content} url={url} />
      )}
      </AppScreenBody>
    </AppScreenShell>
  )
}
