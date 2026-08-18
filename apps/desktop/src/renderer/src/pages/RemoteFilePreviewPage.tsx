import {
  isEditableType,
  prefersUrlPreview,
  shouldFetchTextContent,
  type KnowledgeFile,
} from '@overlay/app-core'
import { FileViewerPanel, type FileViewerOperations } from '@overlay/modules-react/knowledge'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { overlayDesktopAppClient } from '../services/app-api-client'

interface RemoteFilePreviewPageProps {
  fileId: string
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

export function RemoteFilePreviewPage({
  fileId,
  headerLeftSlot,
}: RemoteFilePreviewPageProps): React.ReactElement<any> {
  const [file, setFile] = useState<KnowledgeFile | null>(null)
  const [content, setContent] = useState('')
  const [objectUrl, setObjectUrl] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const metadata = await overlayDesktopAppClient.files.get<KnowledgeFile>({ fileId }, { signal })
      let nextContent = metadata.textContent ?? metadata.content ?? ''
      let nextUrl: string | undefined
      if (shouldFetchTextContent(metadata.name) || prefersUrlPreview(metadata.name) || metadata.isStorageBacked) {
        const response = await overlayDesktopAppClient.files.contentResponse(fileId, { signal })
        if (!response.ok) throw new Error(`Could not load ${metadata.name}`)
        if (shouldFetchTextContent(metadata.name)) nextContent = await response.text()
        else nextUrl = URL.createObjectURL(await response.blob())
      }
      if (signal.aborted) return
      setFile(metadata)
      setContent(nextContent)
      setObjectUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous)
        return nextUrl
      })
    } catch (loadError) {
      if (signal.aborted) return
      setError(loadError instanceof Error ? loadError.message : 'Could not load file')
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [fileId])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])
  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [objectUrl])

  const updateContent = useCallback((value: string) => {
    setContent(value)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      try {
        const response = await overlayDesktopAppClient.files.updateResponse({ fileId, textContent: value })
        if (!response.ok) throw new Error('Could not save file')
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : 'Could not save file')
      } finally {
        setSaving(false)
      }
    }, 800)
  }, [fileId])

  const revealInFinder = useCallback(async () => {
    if (!file) return
    const response = await overlayDesktopAppClient.files.contentResponse(fileId)
    if (!response.ok) throw new Error('Could not download file for Finder')
    await window.bridge.knowledgeFiles.revealDownloaded({
      name: file.name,
      dataBase64: base64(new Uint8Array(await response.arrayBuffer())),
    })
  }, [file, fileId])

  const operations = useMemo<FileViewerOperations>(() => ({
    download({ name, url }) {
      if (!url) return
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = name
      anchor.click()
    },
    async revealLocal() {
      try {
        await revealInFinder()
      } catch (revealError) {
        setError(revealError instanceof Error ? revealError.message : String(revealError))
      }
    },
  }), [revealInFinder])

  if (loading) return <div className="p-6 text-sm text-[var(--muted)]">Loading file…</div>
  if (error && !file) return <div className="p-6 text-sm text-red-500">{error}</div>
  if (!file) return <div className="p-6 text-sm text-[var(--muted)]">File not found.</div>

  return (
    <div className="shared-app-scope flex h-full min-h-0 w-full">
      <FileViewerPanel
        name={file.name}
        content={content}
        url={objectUrl}
        isSaving={saving}
        isEditable={isEditableType(file.name)}
        onContentChange={updateContent}
        headerLeft={headerLeftSlot}
        operations={operations}
      />
    </div>
  )
}
