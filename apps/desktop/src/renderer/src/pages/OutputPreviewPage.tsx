import type { KnowledgeFile } from '@overlay/app-core'
import { OutputViewer, type FileViewerAsset, type FileViewerOperations } from '@overlay/modules-react/knowledge'
import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { overlayDesktopAppClient } from '../services/app-api-client'

interface OutputPreviewPageProps {
  outputId: string
  headerLeftSlot?: ReactNode
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 32_768
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export function OutputPreviewPage({ outputId, headerLeftSlot }: OutputPreviewPageProps): ReactElement<any> {
  const [output, setOutput] = useState<KnowledgeFile | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [objectUrl, setObjectUrl] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    let nextObjectUrl: string | undefined
    setLoading(true)
    setError(null)
    setOutput(null)
    setBlob(null)
    setObjectUrl(undefined)

    void Promise.all([
      overlayDesktopAppClient.files.get<KnowledgeFile>({ fileId: outputId }, { signal: controller.signal }),
      overlayDesktopAppClient.files.contentResponse(outputId, { signal: controller.signal }),
    ]).then(async ([metadata, contentResponse]) => {
      if (!contentResponse.ok) throw new Error(`Could not load ${metadata.name || 'output'}`)
      const nextBlob = await contentResponse.blob()
      if (controller.signal.aborted) return
      nextObjectUrl = URL.createObjectURL(nextBlob)
      setOutput(metadata)
      setBlob(nextBlob)
      setObjectUrl(nextObjectUrl)
    }).catch((loadError: unknown) => {
      if (controller.signal.aborted) return
      setError(loadError instanceof Error ? loadError.message : 'Failed to load output')
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })

    return () => {
      controller.abort()
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl)
    }
  }, [outputId])

  const reveal = useCallback(async ({ name }: FileViewerAsset) => {
    if (!blob) return
    await window.bridge.knowledgeFiles.revealDownloaded({
      name,
      dataBase64: base64(new Uint8Array(await blob.arrayBuffer())),
    })
  }, [blob])

  const operations = useMemo<FileViewerOperations>(() => ({
    download({ name, url }) {
      if (!url) return
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = name
      anchor.click()
    },
    openExternal({ url }) {
      if (url) return window.bridge.openExternal(url)
    },
    revealLocal: reveal,
  }), [reveal])

  if (loading) return <div className="p-6 text-sm text-[var(--muted)]">Loading output…</div>
  if (error || !output) return <div className="p-6 text-sm text-red-500">{error || 'Output not found'}</div>

  return (
    <div className="shared-app-scope flex h-full min-h-0 w-full">
      <OutputViewer
        name={output.name || 'Output'}
        url={objectUrl}
        mimeType={output.mimeType ?? blob?.type}
        outputType={output.outputType}
        modelId={output.modelId}
        prompt={output.prompt}
        createdAt={output.createdAt}
        headerLeft={headerLeftSlot}
        operations={operations}
      />
    </div>
  )
}
