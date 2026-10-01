'use client'

import { useState, useCallback } from 'react'
import { toCanonicalNoteMarkdown } from '@overlay/app-core/note-markdown'
import { chatMessagesToMarkdown } from '@/features/files/lib/export/markdown'
import { exportChatToJSON, exportNoteToJSON } from '@/features/files/lib/export/json'

interface ExportMessage {
  role: string
  content: string
  parts?: Array<{ type: string; text?: string }>
}

interface UseExportOptions {
  type: 'chat' | 'note'
  title: string
  content: string | ExportMessage[]
  metadata?: {
    createdAt?: number
    updatedAt?: number
    modelIds?: string[]
  }
}

export type ExportFormat = 'markdown' | 'pdf' | 'docx' | 'json'

export function useExport({ type, title, content, metadata }: UseExportOptions) {
  const [isExporting, setIsExporting] = useState(false)

  const getMarkdownContent = useCallback((): string => {
    if (type === 'chat' && Array.isArray(content)) {
      return chatMessagesToMarkdown(content)
    }
    if (type === 'note' && typeof content === 'string') {
      return toCanonicalNoteMarkdown(content)
    }
    return ''
  }, [type, content])

  const downloadFile = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [])

  const copyToClipboard = useCallback(
    async (): Promise<void> => {
      const text = getMarkdownContent()
      await navigator.clipboard.writeText(text)
    },
    [getMarkdownContent],
  )

  const exportAs = useCallback(
    async (format: ExportFormat): Promise<void> => {
      setIsExporting(true)
      try {
        const safeTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'export'

        switch (format) {
          case 'markdown': {
            const md = getMarkdownContent()
            const frontmatter = `---\ntitle: ${title}\ndate: ${new Date().toISOString()}\n---\n\n`
            const blob = new Blob([frontmatter + md], { type: 'text/markdown' })
            downloadFile(blob, `${safeTitle}.md`)
            break
          }

          case 'json': {
            let data
            if (type === 'chat' && Array.isArray(content)) {
              data = exportChatToJSON(title, content, { ...metadata, title })
            } else if (type === 'note' && typeof content === 'string') {
              data = exportNoteToJSON(title, content, { ...metadata, title })
            }
            const blob = new Blob([JSON.stringify(data, null, 2)], {
              type: 'application/json',
            })
            downloadFile(blob, `${safeTitle}.json`)
            break
          }

          case 'pdf': {
            const { generatePdfFromMarkdown } = await import('@/features/files/lib/export/pdf')
            const md = getMarkdownContent()
            const blob = await generatePdfFromMarkdown(title, md)
            downloadFile(blob, `${safeTitle}.pdf`)
            break
          }

          case 'docx': {
            const { generateDocxFromMessages, generateDocxFromMarkdown } = await import(
              '@/features/files/lib/export/docx'
            )
            let blob: Blob
            if (type === 'chat' && Array.isArray(content)) {
              blob = await generateDocxFromMessages(
                title,
                content.map((m) => ({
                  role: m.role,
                  content:
                    m.content ||
                    (m.parts
                      ? m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('')
                      : ''),
                })),
              )
            } else {
              const md = getMarkdownContent()
              blob = await generateDocxFromMarkdown(title, md)
            }
            downloadFile(blob, `${safeTitle}.docx`)
            break
          }
        }
      } finally {
        setIsExporting(false)
      }
    },
    [type, title, content, metadata, getMarkdownContent, downloadFile],
  )

  return {
    copyToClipboard,
    exportAs,
    isExporting,
  }
}
