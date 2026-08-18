import { useState, useEffect, useCallback } from 'react'
import { FileText, Plus, Trash2, File, FileSpreadsheet } from 'lucide-react'
import type { PanelTheme } from '../../hooks/usePanelTheme'

interface DocumentInfo {
  id: string
  filename: string
  filepath: string
  mimeType: string
  folderId?: string
  chatId?: string
  chunkCount: number
  createdAt: number
}

interface FolderDocumentsProps {
  folderId: string
  theme: PanelTheme
  isExpanded: boolean
  onToggle: () => void
}

export function FolderDocuments({
  folderId,
  theme,
  isExpanded,
  onToggle
}: FolderDocumentsProps): React.ReactElement<any> {
  const [documents, setDocuments] = useState<DocumentInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isAdding, setIsAdding] = useState(false)

  const loadDocuments = useCallback(async () => {
    setIsLoading(true)
    try {
      const docs = await window.bridge.document.getByFolder(folderId)
      setDocuments(docs || [])
    } catch (error) {
      console.error('[FolderDocuments] Failed to load documents:', error)
      setDocuments([])
    } finally {
      setIsLoading(false)
    }
  }, [folderId])

  useEffect(() => {
    if (isExpanded) {
      loadDocuments()
    }
  }, [isExpanded, loadDocuments])

  const handleAddDocument = async (): Promise<void> => {
    setIsAdding(true)
    try {
      const result = await window.bridge.document.ingestDialog({ folderId })
      if (result.success) {
        await loadDocuments()
      }
    } catch (error) {
      console.error('[FolderDocuments] Failed to add document:', error)
    } finally {
      setIsAdding(false)
    }
  }

  const handleRemoveDocument = async (documentId: string): Promise<void> => {
    try {
      await window.bridge.document.remove(documentId)
      setDocuments((prev) => prev.filter((d) => d.id !== documentId))
    } catch (error) {
      console.error('[FolderDocuments] Failed to remove document:', error)
    }
  }

  const getFileIcon = (mimeType: string): React.ReactElement<any> => {
    if (mimeType.includes('pdf')) {
      return <FileText size={14} color={theme.textSecondary} />
    }
    if (
      mimeType.includes('spreadsheet') ||
      mimeType.includes('csv') ||
      mimeType.includes('excel')
    ) {
      return <FileSpreadsheet size={14} color={theme.textSecondary} />
    }
    return <File size={14} color={theme.textSecondary} />
  }

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div
      style={{
        background: theme.surfaceBg,
        border: `1px solid ${theme.border}`,
        borderRadius: 12,
        overflow: 'hidden',
        marginTop: 12
      }}
    >
      {/* Header */}
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: theme.text
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={14} color={theme.textSecondary} />
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}
          >
            Knowledge Base
          </span>
          <span
            style={{
              fontSize: 11,
              color: theme.textMuted,
              background: theme.surfaceBgHover,
              padding: '2px 6px',
              borderRadius: 10,
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}
          >
            {documents.length}
          </span>
        </div>
        <span
          style={{
            fontSize: 12,
            color: theme.textMuted,
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease'
          }}
        >
          ▼
        </span>
      </button>

      {/* Content */}
      {isExpanded && (
        <div style={{ padding: '0 14px 14px' }}>
          {/* Add document button */}
          <button
            onClick={handleAddDocument}
            disabled={isAdding}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '8px 12px',
              background: theme.surfaceBgHover,
              border: `1px dashed ${theme.border}`,
              borderRadius: 8,
              cursor: isAdding ? 'wait' : 'pointer',
              color: theme.textSecondary,
              fontSize: 13,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              marginBottom: documents.length > 0 ? 10 : 0,
              transition: 'all 0.15s ease',
              opacity: isAdding ? 0.6 : 1
            }}
            onMouseEnter={(e) => {
              if (!isAdding) {
                e.currentTarget.style.background = theme.border
                e.currentTarget.style.borderStyle = 'solid'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = theme.surfaceBgHover
              e.currentTarget.style.borderStyle = 'dashed'
            }}
          >
            <Plus size={14} />
            {isAdding ? 'Adding...' : 'Add Document'}
          </button>

          {/* Loading state */}
          {isLoading && documents.length === 0 && (
            <div
              style={{
                padding: '12px',
                textAlign: 'center',
                color: theme.textMuted,
                fontSize: 12,
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            >
              Loading documents...
            </div>
          )}

          {/* Document list */}
          {documents.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    background: theme.surfaceBgHover,
                    borderRadius: 8,
                    transition: 'background 0.15s ease'
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}
                  >
                    {getFileIcon(doc.mimeType)}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          color: theme.text,
                          fontFamily: 'system-ui, -apple-system, sans-serif',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                      >
                        {doc.filename}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: theme.textMuted,
                          fontFamily: 'system-ui, -apple-system, sans-serif'
                        }}
                      >
                        {doc.chunkCount} chunks · {formatDate(doc.createdAt)}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveDocument(doc.id)}
                    title="Remove document"
                    style={{
                      padding: 6,
                      background: 'transparent',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                      color: theme.textMuted,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.15s ease',
                      flexShrink: 0
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#ef4444'
                      e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = theme.textMuted
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && documents.length === 0 && (
            <div
              style={{
                padding: '8px 0 0',
                textAlign: 'center',
                color: theme.textMuted,
                fontSize: 12,
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            >
              Add PDFs, Word docs, or spreadsheets to enhance AI context
            </div>
          )}
        </div>
      )}
    </div>
  )
}
