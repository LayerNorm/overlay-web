import { useState, useEffect, useCallback, useRef, ReactElement } from 'react'
import { FolderOpen, FileText, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import type { Theme } from '../../utils/theme'
import {
  Folder as NoteFolder,
  generateFolderId,
  loadNoteFolderMap,
  loadNoteFolders,
  saveNoteFolderMap,
  saveNoteFolders
} from '../../utils/folderStorage'

const DIALOG_ANIMATION_DURATION = 150

type ImportSource = 'obsidian' | 'bear' | 'apple-notes'

interface DetectedApps {
  obsidian: boolean
  bear: boolean
  appleNotes: boolean
}

interface ImportedNote {
  title: string
  content: string
  createdAt?: number
  updatedAt?: number
  tags: string[]
  source: string
  sourceId?: string
  folderPath?: string[]
}

type ImportStatus = 'idle' | 'reading' | 'saving' | 'done' | 'error'

interface ImportNotesDialogProps {
  isOpen: boolean
  onClose: () => void
  theme: Theme
}

interface SavedImportedNote {
  id: string
  folderPath?: string[]
}

function normalizeFolderPath(folderPath: string[] | undefined): string[] {
  if (!Array.isArray(folderPath)) return []
  return folderPath
    .map((segment) => String(segment).trim())
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function createImportedNoteFolders(savedNotes: SavedImportedNote[]): {
  createdFolders: number
  assignedNotes: number
} {
  const notesWithFolders = savedNotes
    .map((savedNote) => ({
      id: savedNote.id,
      folderPath: normalizeFolderPath(savedNote.folderPath)
    }))
    .filter((savedNote) => savedNote.folderPath.length > 0)

  if (notesWithFolders.length === 0) {
    return { createdFolders: 0, assignedNotes: 0 }
  }

  const folders = loadNoteFolders()
  const folderMap = loadNoteFolderMap()
  const folderKeyToId = new Map<string, string>()

  for (const folder of folders) {
    const key = `${folder.parentId ?? '__root__'}::${folder.name}`
    folderKeyToId.set(key, folder.id)
  }

  const now = Date.now()
  let createdFolders = 0
  let assignedNotes = 0

  for (const savedNote of notesWithFolders) {
    let parentId: string | null = null

    for (const folderName of savedNote.folderPath) {
      const key = `${parentId ?? '__root__'}::${folderName}`
      let folderId = folderKeyToId.get(key)

      if (!folderId) {
        folderId = generateFolderId()
        const folder: NoteFolder = {
          id: folderId,
          name: folderName,
          parentId,
          instructions: '',
          createdAt: now,
          updatedAt: now,
          isExpanded: true
        }
        folders.push(folder)
        folderKeyToId.set(key, folderId)
        createdFolders++
      }

      parentId = folderId
    }

    if (parentId) {
      folderMap[savedNote.id] = parentId
      assignedNotes++
    }
  }

  saveNoteFolders(folders)
  saveNoteFolderMap(folderMap)

  return { createdFolders, assignedNotes }
}

const SOURCE_CONFIG: Record<
  ImportSource,
  {
    label: string
    description: string
    instructions: string
    detectionKey: keyof DetectedApps
  }
> = {
  obsidian: {
    label: 'Obsidian',
    description: 'Import markdown notes from an Obsidian vault folder.',
    instructions:
      'Select your Obsidian vault folder. All markdown files will be imported, including tags from frontmatter and inline #tags.',
    detectionKey: 'obsidian'
  },
  bear: {
    label: 'Bear',
    description: 'Import notes exported from Bear as markdown.',
    instructions:
      'First, export your Bear notes: open Bear, go to File → Export Notes, choose "Markdown" format, and export to a folder. Then select that folder here.',
    detectionKey: 'bear'
  },
  'apple-notes': {
    label: 'Apple Notes',
    description: 'Import notes from Apple Notes using automation.',
    instructions:
      'This will use macOS Automation to read your Apple Notes. You may be prompted to grant Overlay permission to control the Notes app.',
    detectionKey: 'appleNotes'
  }
}

export function ImportNotesDialog({
  isOpen,
  onClose,
  theme
}: ImportNotesDialogProps): ReactElement<any> | null {
  const [isAnimating, setIsAnimating] = useState(false)
  const [shouldRender, setShouldRender] = useState(false)
  const [selectedSource, setSelectedSource] = useState<ImportSource>('obsidian')
  const [detectedApps, setDetectedApps] = useState<DetectedApps | null>(null)
  const [status, setStatus] = useState<ImportStatus>('idle')
  const [importedNotes, setImportedNotes] = useState<ImportedNote[]>([])
  const [savedCount, setSavedCount] = useState(0)
  const [createdFolderCount, setCreatedFolderCount] = useState(0)
  const [organizedNoteCount, setOrganizedNoteCount] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [iCloudWarning, setICloudWarning] = useState('')
  const cancelledRef = useRef(false)

  // Animation handling
  useEffect(() => {
    let timer: NodeJS.Timeout | undefined
    if (isOpen) {
      setShouldRender(true)
      requestAnimationFrame(() => setIsAnimating(true))
    } else {
      setIsAnimating(false)
      timer = setTimeout(() => setShouldRender(false), DIALOG_ANIMATION_DURATION)
    }
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [isOpen])

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setStatus('idle')
      setImportedNotes([])
      setSavedCount(0)
      setCreatedFolderCount(0)
      setOrganizedNoteCount(0)
      setErrorMessage('')
      setICloudWarning('')
      cancelledRef.current = false
    }
  }, [isOpen])

  // Detect installed apps
  useEffect(() => {
    if (isOpen && !detectedApps) {
      window.bridge.import.detectApps().then(setDetectedApps).catch(console.error)
    }
  }, [isOpen, detectedApps])

  const handleImport = useCallback(async () => {
    cancelledRef.current = false
    setStatus('reading')
    setErrorMessage('')
    setICloudWarning('')
    setImportedNotes([])
    setSavedCount(0)
    setCreatedFolderCount(0)
    setOrganizedNoteCount(0)

    try {
      let result: {
        notes: ImportedNote[]
        error?: string
        cancelled?: boolean
        iCloudWarning?: string
      }

      if (selectedSource === 'obsidian') {
        result = await window.bridge.import.obsidian()
      } else if (selectedSource === 'bear') {
        result = await window.bridge.import.bear()
      } else {
        result = await window.bridge.import.appleNotes()
      }

      // User cancelled while we were reading
      if (cancelledRef.current) {
        setStatus('idle')
        return
      }

      if (result.cancelled) {
        setStatus('idle')
        return
      }

      if (result.iCloudWarning) {
        setICloudWarning(result.iCloudWarning)
      }

      if (result.error) {
        setStatus('error')
        setErrorMessage(result.error)
        return
      }

      if (result.notes.length === 0) {
        setStatus('error')
        setErrorMessage('No notes found to import.')
        return
      }

      setImportedNotes(result.notes)
      setStatus('saving')

      // Check again before saving
      if (cancelledRef.current) {
        setStatus('idle')
        return
      }

      // Save all notes at once via the batch endpoint
      const saveResult = await window.bridge.import.saveNotes(result.notes)

      // If cancelled during save, still report what was saved
      if (cancelledRef.current) {
        if (saveResult.saved > 0) {
          setSavedCount(saveResult.saved)
          setStatus('done')
        } else {
          setStatus('idle')
        }
        return
      }

      const savedNotes: SavedImportedNote[] =
        Array.isArray(saveResult.savedNotes) && saveResult.savedNotes.length > 0
          ? saveResult.savedNotes
          : saveResult.ids.map((id: string, index: number) => ({
              id,
              folderPath: result.notes[index]?.folderPath
            }))

      let createdFolders = 0
      let assignedNotes = 0
      try {
        const folderResult = createImportedNoteFolders(savedNotes)
        createdFolders = folderResult.createdFolders
        assignedNotes = folderResult.assignedNotes
      } catch (folderError) {
        console.error('[Import] Failed to apply imported folder structure:', folderError)
      }
      setCreatedFolderCount(createdFolders)
      setOrganizedNoteCount(assignedNotes)

      if (assignedNotes > 0) {
        try {
          await window.bridge.import.notifyNotesChanged()
        } catch {
          // Fall back to the initial import event if re-broadcast fails.
        }
      }

      setSavedCount(saveResult.saved)
      setStatus('done')
    } catch (err) {
      if (cancelledRef.current) {
        setStatus('idle')
        return
      }
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : String(err))
    }
  }, [selectedSource])

  const handleCancel = useCallback(() => {
    cancelledRef.current = true
    setStatus('idle')
    setImportedNotes([])
    setCreatedFolderCount(0)
    setOrganizedNoteCount(0)
    setErrorMessage('')
  }, [])

  const handleClose = useCallback(() => {
    if (status === 'reading' || status === 'saving') {
      // Cancel the import and close
      cancelledRef.current = true
      setStatus('idle')
    }
    onClose()
  }, [status, onClose])

  if (!shouldRender) return null

  const sourceConfig = SOURCE_CONFIG[selectedSource]
  const isDetected = detectedApps ? detectedApps[sourceConfig.detectionKey] : null
  const isImporting = status === 'reading' || status === 'saving'

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: theme.scrim,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        opacity: isAnimating ? 1 : 0,
        transition: `opacity ${DIALOG_ANIMATION_DURATION}ms ease-out`,
        overflow: 'hidden'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div
        style={{
          background: theme.modalBackground,
          borderRadius: '16px',
          width: '640px',
          maxWidth: '90vw',
          height: '500px',
          maxHeight: '85vh',
          display: 'flex',
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.35)',
          border: `1px solid ${theme.modalBorder}`,
          transform: isAnimating ? 'scale(1) translateY(0)' : 'scale(0.96) translateY(8px)',
          transition: `transform ${DIALOG_ANIMATION_DURATION}ms ease-out`,
          // @ts-expect-error - webkit property for electron drag region
          WebkitAppRegion: 'no-drag'
        }}
      >
        {/* Sidebar */}
        <div
          style={{
            width: '180px',
            flexShrink: 0,
            borderRight: `1px solid ${theme.border}`,
            display: 'flex',
            flexDirection: 'column',
            padding: '20px 0'
          }}
        >
          <div
            style={{
              padding: '0 20px 16px',
              fontSize: '13px',
              fontWeight: 600,
              color: theme.text,
              fontFamily:
                'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
            }}
          >
            Import From
          </div>

          {(Object.keys(SOURCE_CONFIG) as ImportSource[]).map((source) => {
            const config = SOURCE_CONFIG[source]
            const isSelected = selectedSource === source
            const detected = detectedApps ? detectedApps[config.detectionKey] : null

            return (
              <button
                key={source}
                onClick={() => {
                  if (!isImporting) {
                    setSelectedSource(source)
                    setStatus('idle')
                    setErrorMessage('')
                  }
                }}
                disabled={isImporting}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 20px',
                  background: isSelected ? theme.selectionBg : 'transparent',
                  border: 'none',
                  borderLeft: isSelected ? `2px solid ${theme.accent}` : '2px solid transparent',
                  cursor: isImporting ? 'not-allowed' : 'pointer',
                  color: isSelected ? theme.text : theme.textSecondary,
                  fontSize: '13px',
                  fontWeight: isSelected ? 500 : 400,
                  fontFamily:
                    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                  textAlign: 'left',
                  transition: 'all 0.15s ease',
                  opacity: isImporting && !isSelected ? 0.5 : 1
                }}
                onMouseEnter={(e) => {
                  if (!isSelected && !isImporting) {
                    e.currentTarget.style.background = theme.surface
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'transparent'
                }}
              >
                <span>{config.label}</span>
                {detected !== null && (
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: detected ? '#22c55e' : theme.textDisabled,
                      flexShrink: 0
                    }}
                    title={detected ? 'Detected on this Mac' : 'Not detected'}
                  />
                )}
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            padding: '24px',
            overflow: 'hidden'
          }}
        >
          {/* Source header */}
          <div style={{ marginBottom: '20px' }}>
            <h2
              style={{
                color: theme.text,
                fontSize: '18px',
                fontWeight: '600',
                margin: '0 0 8px 0',
                fontFamily:
                  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
              }}
            >
              {sourceConfig.label}
            </h2>
            <p
              style={{
                color: theme.textSecondary,
                fontSize: '13px',
                margin: 0,
                lineHeight: '1.5'
              }}
            >
              {sourceConfig.description}
            </p>
          </div>

          {/* Detection status */}
          {isDetected !== null && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 14px',
                borderRadius: '8px',
                background: isDetected ? 'rgba(34, 197, 94, 0.08)' : `${theme.surface}`,
                border: `1px solid ${isDetected ? 'rgba(34, 197, 94, 0.2)' : theme.border}`,
                marginBottom: '16px',
                fontSize: '12px',
                color: isDetected ? '#22c55e' : theme.textSecondary
              }}
            >
              {isDetected ? (
                <>
                  <CheckCircle2 size={14} />
                  <span>{sourceConfig.label} detected on this Mac</span>
                </>
              ) : (
                <>
                  <AlertCircle size={14} />
                  <span>{sourceConfig.label} not detected — you can still import from files</span>
                </>
              )}
            </div>
          )}

          {/* Instructions */}
          {status === 'idle' && (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              <div
                style={{
                  padding: '14px',
                  borderRadius: '10px',
                  border: `1px dashed ${theme.border}`,
                  fontSize: '13px',
                  color: theme.textSecondary,
                  lineHeight: '1.6'
                }}
              >
                {sourceConfig.instructions}
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  marginTop: '20px',
                  justifyContent: 'flex-end'
                }}
              >
                <button
                  onClick={handleClose}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 500,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    color: theme.text,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = theme.border
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleImport}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 500,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    color: theme.toggleThumb,
                    background: theme.buttonBg,
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'background 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = theme.buttonHover
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = theme.buttonBg
                  }}
                >
                  {selectedSource === 'apple-notes' ? (
                    <>
                      <FileText size={14} />
                      Import Notes
                    </>
                  ) : (
                    <>
                      <FolderOpen size={14} />
                      Select Folder
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Importing state */}
          {(status === 'reading' || status === 'saving') && (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '16px'
                }}
              >
                <Loader2
                  size={32}
                  color={theme.textSecondary}
                  style={{
                    animation: 'spin 1s linear infinite'
                  }}
                />
                <div
                  style={{
                    fontSize: '14px',
                    color: theme.text,
                    fontWeight: 500
                  }}
                >
                  {status === 'reading'
                    ? `Reading notes from ${sourceConfig.label}...`
                    : `Saving ${importedNotes.length} notes...`}
                </div>
                {status === 'saving' && (
                  <div
                    style={{
                      fontSize: '12px',
                      color: theme.textSecondary
                    }}
                  >
                    This may take a moment for large libraries
                  </div>
                )}
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  marginTop: '20px'
                }}
              >
                <button
                  onClick={handleCancel}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 500,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    color: theme.text,
                    background: 'transparent',
                    border: `1px solid ${theme.border}`,
                    cursor: 'pointer',
                    transition: 'background 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = theme.border
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Done state */}
          {status === 'done' && (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 1,
                  gap: '16px'
                }}
              >
                <CheckCircle2 size={40} color="#22c55e" strokeWidth={1.5} />
                <div
                  style={{
                    fontSize: '16px',
                    fontWeight: 600,
                    color: theme.text
                  }}
                >
                  Import Complete
                </div>
                <div
                  style={{
                    fontSize: '13px',
                    color: theme.textSecondary,
                    textAlign: 'center',
                    lineHeight: '1.5'
                  }}
                >
                  Successfully imported {savedCount} {savedCount === 1 ? 'note' : 'notes'} from{' '}
                  {sourceConfig.label}.
                  <br />
                  You can find them in your notebook.
                </div>
                {organizedNoteCount > 0 && (
                  <div
                    style={{
                      fontSize: '12px',
                      color: theme.textSecondary,
                      textAlign: 'center'
                    }}
                  >
                    Organized {organizedNoteCount} note{organizedNoteCount === 1 ? '' : 's'} into{' '}
                    {createdFolderCount} folder{createdFolderCount === 1 ? '' : 's'}.
                  </div>
                )}
                {iCloudWarning && (
                  <div
                    style={{
                      marginTop: '8px',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      background: 'rgba(245, 158, 11, 0.08)',
                      border: '1px solid rgba(245, 158, 11, 0.2)',
                      fontSize: '12px',
                      color: '#d97706',
                      lineHeight: '1.5',
                      textAlign: 'left',
                      maxWidth: '400px'
                    }}
                  >
                    {iCloudWarning}
                  </div>
                )}
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  marginTop: '20px'
                }}
              >
                <button
                  onClick={handleClose}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 500,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    color: theme.toggleThumb,
                    background: theme.buttonBg,
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = theme.buttonHover
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = theme.buttonBg
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {/* Error state */}
          {status === 'error' && (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 1,
                  gap: '16px'
                }}
              >
                <AlertCircle size={40} color="rgba(255, 100, 100, 0.8)" strokeWidth={1.5} />
                <div
                  style={{
                    fontSize: '16px',
                    fontWeight: 600,
                    color: theme.text
                  }}
                >
                  Import Failed
                </div>
                <div
                  style={{
                    fontSize: '13px',
                    color: theme.textSecondary,
                    textAlign: 'center',
                    lineHeight: '1.5',
                    maxWidth: '360px',
                    wordBreak: 'break-word'
                  }}
                >
                  {errorMessage}
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  justifyContent: 'flex-end',
                  marginTop: '20px'
                }}
              >
                <button
                  onClick={handleClose}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 500,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    color: theme.text,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = theme.border
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    setStatus('idle')
                    setErrorMessage('')
                  }}
                  style={{
                    padding: '10px 20px',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 500,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    color: theme.toggleThumb,
                    background: theme.buttonBg,
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = theme.buttonHover
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = theme.buttonBg
                  }}
                >
                  Try Again
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
