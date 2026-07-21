'use client'

import {
  FILE_PARITY_FILES,
  createFixtureKnowledgeSurfaceAdapters,
  type KnowledgeFileNode,
} from '@overlay/app-core'
import { SharedKnowledgeSurface } from '@overlay/modules-react/knowledge'
import { useEffect, useMemo, useState } from 'react'

export function SharedKnowledgeSurfaceHarness({
  theme,
  width,
}: {
  theme: 'light' | 'dark'
  width: number
}) {
  const [route, setRoute] = useState({
    file: null as string | null,
    memory: null as string | null,
    folder: null as string | null,
    view: 'all' as string | null,
    layout: 'list' as string | null,
    outputFilter: null as string | null,
  })
  const initialFiles = useMemo(() => FILE_PARITY_FILES.map((file) => ({ ...file })) as KnowledgeFileNode[], [])
  const adapters = useMemo(() => createFixtureKnowledgeSurfaceAdapters(), [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.body.dataset.fileParityFixture = 'true'
    document.body.dataset.fileParityReady = 'true'
    return () => {
      delete document.body.dataset.fileParityFixture
      delete document.body.dataset.fileParityReady
    }
  }, [theme])

  return (
    <div style={{ height: 900, margin: '0 auto', maxWidth: width, width: '100%' }} data-file-parity-ready="true">
      <SharedKnowledgeSurface
        mode="files"
        initialFiles={initialFiles}
        initialMemories={[]}
        route={route}
        onUpdateQuery={(updates) => setRoute((current) => ({
          ...current,
          file: updates.file === undefined ? current.file : updates.file ?? null,
          folder: updates.folder === undefined ? current.folder : updates.folder ?? null,
          view: updates.view === undefined ? current.view : updates.view ?? null,
          layout: updates.layout === undefined ? current.layout : updates.layout ?? null,
          outputFilter: updates.out === undefined ? current.outputFilter : updates.out ?? null,
        }))}
        adapters={adapters}
        memories={{ list: async () => [], create: async () => ({ ok: true }), delete: async () => true }}
        files={{
          saveContent: async () => true,
          upload: async () => ({ ok: true }),
          isEditable: (name) => /\.(?:md|markdown|txt|csv)$/i.test(name),
          contentUrl: () => undefined,
          entityChanged: () => undefined,
        }}
        renderFileViewer={({ content }) => <pre>{content}</pre>}
      />
    </div>
  )
}
