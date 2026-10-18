'use client'

import { useEffect, useState, type ComponentProps } from 'react'
import type { KnowledgeFileNode } from '@overlay/app-core'
import { getFileType } from '@overlay/app-core/file-viewer'
import { fileMarkdownHref, resolveFileMarkdownLinks, type FileLinkNode } from '@overlay/app-core/file-markdown-links'
import { readFileLinkChildren } from '@/features/knowledge/adapters/file-markdown-links'
import KnowledgeView from '@/features/knowledge/components/KnowledgeView'
import { FileViewer, OutputViewer, type FileViewerAsset } from '@overlay/modules-react/knowledge'
import { safeHttpUrl } from '@/shared/security/safe-url'

type KnowledgeViewProps = ComponentProps<typeof KnowledgeView>

function downloadInBrowser({ name, url }: FileViewerAsset): void {
  if (!url) return
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.rel = 'noopener noreferrer'
  anchor.click()
}

function openInBrowser({ url }: FileViewerAsset): void {
  const safe = safeHttpUrl(url)
  if (safe) window.open(safe, '_blank', 'noopener,noreferrer')
}

const browserViewerOperations = {
  download: downloadInBrowser,
  openExternal: openInBrowser,
}

function LinkedFileViewer({ file, name, content, url }: { file: KnowledgeFileNode; name: string; content: string; url?: string }) {
  const [targets, setTargets] = useState<ReadonlyMap<string, FileLinkNode>>(() => new Map())
  const scope = file.scope ?? 'personal'
  useEffect(() => {
    if (getFileType(name) !== 'markdown') return
    const controller = new AbortController()
    void resolveFileMarkdownLinks({ content, file,
      listChildren: parentId => readFileLinkChildren({ parentId, scope, signal: controller.signal }),
    }).then(next => { if (!controller.signal.aborted) setTargets(next) }).catch(() => undefined)
    return () => controller.abort()
  }, [content, file, name, scope])
  const resolveFileHref = (href: string) => fileMarkdownHref(href, targets)
  return file.kind === 'output' ? (
    <OutputViewer name={name} content={content} url={url} mimeType={file.mimeType}
      outputType={file.outputType} modelId={file.modelId} prompt={file.prompt} createdAt={file.createdAt}
      operations={browserViewerOperations} resolveFileHref={resolveFileHref} />
  ) : <FileViewer name={name} content={content} url={url} operations={browserViewerOperations} resolveFileHref={resolveFileHref} />
}

export default function KnowledgeViewHost(props: Omit<KnowledgeViewProps, 'renderFileViewer'>) {
  return <KnowledgeView {...props} renderFileViewer={viewer => (
    <LinkedFileViewer key={`${viewer.file._id}:${viewer.file.parentId ?? ''}:${viewer.file.scope ?? 'personal'}:${viewer.file.userId ?? ''}`}
      {...viewer} />
  )} />
}
