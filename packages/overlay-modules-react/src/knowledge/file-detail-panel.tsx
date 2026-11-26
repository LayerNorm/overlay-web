'use client'
import { Button, Textarea } from '@overlay/ui/primitives'
import { unstyledTextarea } from '@overlay/ui/control-reset'
import { getFileType } from '@overlay/app-core/file-viewer'
import { Eye, Pencil } from 'lucide-react'
import { useState, type ReactNode } from 'react'

export function KnowledgeFileDetailPanel({
  fileId,
  fileName,
  isEditable,
  fileContent,
  onContentChange,
  renderViewer,
}: {
  /** Which file is open: switching files returns to its rendered view. */
  fileId?: string
  fileName: string
  isEditable: boolean
  fileContent: string
  onContentChange: (value: string) => void
  renderViewer: () => ReactNode
}) {
  // A page or a Markdown document opens rendered; its source is one click away. Plain text opens as text.
  const type = getFileType(fileName)
  const rendersFirst = type === 'html' || type === 'markdown'
  const fileKey = fileId ?? fileName
  const [sourceOpenFor, setSourceOpenFor] = useState<string | null>(null)
  const editing = isEditable && (!rendersFirst || sourceOpenFor === fileKey)
  const toggle = isEditable && rendersFirst ? (
    <div className="flex shrink-0 justify-end pb-2">
      <Button variant="ghost" size="xs" onClick={() => setSourceOpenFor(editing ? null : fileKey)}>
        {editing ? <Eye className="size-3.5" aria-hidden /> : <Pencil className="size-3.5" aria-hidden />}
        {editing ? 'Preview' : 'Edit'}
      </Button>
    </div>
  ) : null
  return (
    <div className={`mx-auto flex min-h-full w-full flex-col ${editing ? 'max-w-5xl' : ''}`}>
      {toggle}
      {editing ? (
        <>
          <Textarea
            aria-label="File contents"
            value={fileContent}
            onChange={(e) => onContentChange(e.target.value)}
            placeholder="Start typing..."
            className={unstyledTextarea("min-h-[calc(100vh-11rem)] w-full flex-1 resize-none bg-transparent px-2 py-4 font-mono text-sm leading-relaxed text-(--foreground) outline-hidden placeholder:text-(--muted-light)")}
          />
          <div className="shrink-0 border-t border-(--border) px-2 py-2 text-[11px] text-(--muted-light)">
            Reference in chat with{' '}
            <code className="rounded-sm bg-(--surface-subtle) px-1 py-0.5 font-mono text-(--foreground)">
              @{fileName}
            </code>
          </div>
        </>
      ) : (
        <div className={`flex flex-col overflow-hidden ${toggle ? 'h-[calc(100vh-11rem)]' : 'h-[calc(100vh-9rem)]'}`}>{renderViewer()}</div>
      )}
    </div>
  )
}
