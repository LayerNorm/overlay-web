/* eslint-disable @next/next/no-img-element */
import Link from 'next/link'
import { Download } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import type { SharedFile } from '@/app/share/f/[token]/page'

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

function PreviewBody({ file, token }: { file: SharedFile; token: string }) {
  const binaryUrl = file.hasBinary ? `/api/share/file/${token}` : null

  if (file.kind === 'note' && file.content) {
    return (
      <article className="prose prose-neutral max-w-none rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-6 py-6 text-[var(--foreground)] dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
          {file.content}
        </ReactMarkdown>
      </article>
    )
  }

  if (file.mimeType?.startsWith('image/') && binaryUrl) {
    return (
      <div className="flex justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
        <img src={binaryUrl} alt={file.name} className="max-h-[80vh] max-w-full rounded-lg object-contain" />
      </div>
    )
  }

  if (file.mimeType === 'application/pdf' && binaryUrl) {
    return (
      <iframe
        src={binaryUrl}
        title={file.name}
        className="h-[80vh] w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]"
      />
    )
  }

  if (file.textContent) {
    return (
      <pre className="overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-5 py-4 text-sm leading-relaxed text-[var(--foreground)]">
        {file.textContent}
      </pre>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-6 py-12 text-center">
      <p className="text-sm text-[var(--muted)]">No inline preview available for this file.</p>
      {binaryUrl && (
        <a
          href={binaryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full bg-[var(--foreground)] px-4 py-2 text-xs font-medium text-[var(--background)] transition-opacity hover:opacity-90"
        >
          <Download size={14} />
          Download
        </a>
      )}
    </div>
  )
}

export function SharedFileView({ file, token }: { file: SharedFile; token: string }) {
  const sharedAt = new Date(file.sharedAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
  const meta = [
    file.kind === 'note' ? 'Note' : (file.extension?.toUpperCase() || file.mimeType || 'File'),
    formatBytes(file.sizeBytes),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium">{file.name}</h1>
            <p className="text-[11px] text-[var(--muted)]">
              {meta ? `${meta} · ` : ''}Shared {sharedAt} · Read-only
            </p>
          </div>
          <Link
            href="/"
            className="shrink-0 rounded-full border border-[var(--border)] px-3 py-1 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-subtle)]"
          >
            Open Overlay
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8">
        <PreviewBody file={file} token={token} />
      </main>

      <footer className="mx-auto max-w-3xl px-5 pb-10">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-3 text-xs text-[var(--muted)]">
          This is a read-only snapshot shared from{' '}
          <Link href="/" className="font-medium text-[var(--foreground)] hover:underline">
            Overlay
          </Link>
          .
        </div>
      </footer>
    </div>
  )
}
