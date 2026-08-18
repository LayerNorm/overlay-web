import { FileViewerPanel } from '@overlay/modules-react/knowledge'
import { useEffect, useState, type ReactNode } from 'react'

export function LocalDocumentPreviewPage({
  documentId,
  headerLeftSlot,
}: {
  documentId: string
  headerLeftSlot?: ReactNode
}): React.ReactElement<any> {
  const [name, setName] = useState('Local document')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      window.bridge.document.getAll(250),
      window.bridge.document.getChunks(documentId),
    ]).then(([documents, chunks]) => {
      if (cancelled) return
      const document = documents.find((candidate) => candidate.id === documentId)
      setName(document?.filename || 'Local document')
      if (!chunks.success) throw new Error(chunks.error || 'Could not load local document')
      setContent(chunks.chunks.sort((left, right) => left.chunkIndex - right.chunkIndex).map((chunk) => chunk.content).join('\n\n'))
    }).catch((loadError: unknown) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [documentId])

  if (loading) return <div className="p-6 text-sm text-[var(--muted)]">Loading local document…</div>
  if (error) return <div role="alert" className="p-6 text-sm text-red-500">{error}</div>
  return (
    <div className="shared-app-scope flex h-full min-h-0 w-full">
      <FileViewerPanel
        name={name}
        previewName={`${name}.md`}
        content={content}
        headerLeft={headerLeftSlot}
      />
    </div>
  )
}
