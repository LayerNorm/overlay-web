import { useState, useEffect, useCallback, useRef } from 'react'
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

interface ChatDocumentsProps {
  chatId: string
  theme: PanelTheme
  onDocumentCountChange?: (count: number) => void
}

export function ChatDocuments({
  chatId,
  theme,
  onDocumentCountChange
}: ChatDocumentsProps): React.ReactElement {
  const [documents, setDocuments] = useState<DocumentInfo[]>([])
  const [isExpanded, setIsExpanded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const loadDocuments = useCallback(async () => {
    if (!chatId) return
    setIsLoading(true)
    try {
      const docs = await window.bridge.document.getByChat(chatId)
      setDocuments(docs || [])
      onDocumentCountChange?.(docs?.length || 0)
    } catch (error) {
      console.error('[ChatDocuments] Failed to load documents:', error)
      setDocuments([])
      onDocumentCountChange?.(0)
    } finally {
      setIsLoading(false)
    }
  }, [chatId, onDocumentCountChange])

  useEffect(() => {
    loadDocuments()
  }, [loadDocuments])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsExpanded(false)
      }
    }
    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isExpanded])

  const handleAddDocument = async (): Promise<void> => {
    setIsAdding(true)
    try {
      const result = await window.bridge.document.ingestDialog({ chatId })
      if (result.success) {
        await loadDocuments()
      }
    } catch (error) {
      console.error('[ChatDocuments] Failed to add document:', error)
    } finally {
      setIsAdding(false)
    }
  }

  const handleRemoveDocument = async (documentId: string): Promise<void> => {
    try {
      await window.bridge.document.remove(documentId)
      const newDocs = documents.filter((d) => d.id !== documentId)
      setDocuments(newDocs)
      onDocumentCountChange?.(newDocs.length)
    } catch (error) {
      console.error('[ChatDocuments] Failed to remove document:', error)
    }
  }

  const getFileIcon = (mimeType: string): React.ReactElement => {
    if (mimeType.includes('pdf')) {
      return <FileText size={12} color={theme.textSecondary} />
    }
    if (
      mimeType.includes('spreadsheet') ||
      mimeType.includes('csv') ||
      mimeType.includes('excel')
    ) {
      return <FileSpreadsheet size={12} color={theme.textSecondary} />
    }
    return <File size={12} color={theme.textSecondary} />
  }

  const hasDocuments = documents.length > 0

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      {/* Attachment button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        title={
          hasDocuments
            ? `${documents.length} document(s) attached`
            : 'Attach documents to this chat'
        }
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          background: hasDocuments
            ? theme.isDark
              ? 'rgba(59, 130, 246, 0.15)'
              : 'rgba(59, 130, 246, 0.1)'
            : 'transparent',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          position: 'relative'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = hasDocuments
            ? theme.isDark
              ? 'rgba(59, 130, 246, 0.25)'
              : 'rgba(59, 130, 246, 0.18)'
            : theme.surfaceBgHover
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = hasDocuments
            ? theme.isDark
              ? 'rgba(59, 130, 246, 0.15)'
              : 'rgba(59, 130, 246, 0.1)'
            : 'transparent'
        }}
      >
        <FileText size={16} color={hasDocuments ? '#3b82f6' : theme.textSecondary} />
        {hasDocuments && (
          <span
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: '#3b82f6',
              color: '#fff',
              fontSize: 9,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}
          >
            {documents.length}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {isExpanded && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            marginBottom: 8,
            minWidth: 280,
            maxWidth: 320,
            background: theme.isDark ? 'rgba(30, 30, 30, 0.98)' : 'rgba(255, 255, 255, 0.98)',
            border: `1px solid ${theme.border}`,
            borderRadius: 12,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
            overflow: 'hidden',
            zIndex: 1000
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              borderBottom: `1px solid ${theme.border}`
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: theme.text,
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            >
              Chat Documents
            </span>
            <span
              style={{
                fontSize: 10,
                color: theme.textMuted,
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            >
              Temporary for this chat
            </span>
          </div>

          {/* Content */}
          <div style={{ padding: 10, maxHeight: 240, overflowY: 'auto' }}>
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
                fontSize: 12,
                fontFamily: 'system-ui, -apple-system, sans-serif',
                marginBottom: documents.length > 0 ? 8 : 0,
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
                  fontSize: 11,
                  fontFamily: 'system-ui, -apple-system, sans-serif'
                }}
              >
                Loading...
              </div>
            )}

            {/* Document list */}
            {documents.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 8px',
                      background: theme.surfaceBgHover,
                      borderRadius: 6
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        flex: 1,
                        minWidth: 0
                      }}
                    >
                      {getFileIcon(doc.mimeType)}
                      <span
                        style={{
                          fontSize: 12,
                          color: theme.text,
                          fontFamily: 'system-ui, -apple-system, sans-serif',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                      >
                        {doc.filename}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: theme.textMuted,
                          fontFamily: 'system-ui, -apple-system, sans-serif',
                          flexShrink: 0
                        }}
                      >
                        {doc.chunkCount} chunks
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemoveDocument(doc.id)}
                      title="Remove"
                      style={{
                        padding: 4,
                        background: 'transparent',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        color: theme.textMuted,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = '#ef4444'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = theme.textMuted
                      }}
                    >
                      <Trash2 size={12} />
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
                  fontSize: 11,
                  fontFamily: 'system-ui, -apple-system, sans-serif'
                }}
              >
                Add PDFs, docs, or spreadsheets for AI context
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
