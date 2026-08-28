'use client'

import type { ComponentProps } from 'react'
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

export default function KnowledgeViewHost(props: Omit<KnowledgeViewProps, 'renderFileViewer'>) {
  return (
    <KnowledgeView
      {...props}
      renderFileViewer={({ file, name, content, url }) => file.kind === 'output' ? (
        <OutputViewer
          name={name}
          content={content}
          url={url}
          mimeType={file.mimeType}
          outputType={file.outputType}
          modelId={file.modelId}
          prompt={file.prompt}
          createdAt={file.createdAt}
          operations={browserViewerOperations}
        />
      ) : (
        <FileViewer name={name} content={content} url={url} operations={browserViewerOperations} />
      )}
    />
  )
}
