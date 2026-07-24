'use client'

import type { ReactNode } from 'react'

export function KnowledgeFileDetailPanel({
  fileName,
  isEditable,
  fileContent,
  onContentChange,
  renderViewer,
}: {
  fileName: string
  isEditable: boolean
  fileContent: string
  onContentChange: (value: string) => void
  renderViewer: () => ReactNode
}) {
  return (
    <div className={`mx-auto flex min-h-full w-full flex-col ${isEditable ? 'max-w-5xl' : ''}`}>
      {isEditable ? (
        <>
          <textarea
            value={fileContent}
            onChange={(e) => onContentChange(e.target.value)}
            placeholder="Start typing..."
            className="min-h-[calc(100vh-11rem)] w-full flex-1 resize-none bg-transparent px-2 py-4 font-mono text-sm leading-relaxed text-[var(--foreground)] outline-none placeholder:text-[var(--muted-light)]"
          />
          <div className="shrink-0 border-t border-[var(--border)] px-2 py-2 text-[11px] text-[var(--muted-light)]">
            Reference in chat with{' '}
            <code className="rounded bg-[var(--surface-subtle)] px-1 py-0.5 font-mono text-[var(--foreground)]">
              @{fileName}
            </code>
          </div>
        </>
      ) : (
        <div className="flex h-[calc(100vh-9rem)] flex-col overflow-hidden">{renderViewer()}</div>
      )}
    </div>
  )
}
