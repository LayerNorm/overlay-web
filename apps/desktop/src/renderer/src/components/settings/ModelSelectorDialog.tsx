import React, { useState, useEffect, useCallback } from 'react'
import { Theme, lightTheme } from '../../utils/theme'

const DIALOG_ANIMATION_DURATION = 150

interface ModelSelectorDialogProps {
  isOpen: boolean
  onClose: () => void
  onSave: (modelId: string) => void
  currentModelId: string
  theme?: Theme
}

interface ModelOption {
  id: string
  name: string
  description: string
  size: string
  quality: string
  speed: string
  bundled: boolean
  huggingfaceFolder: string
  macOSOnly?: boolean
  isDefault?: boolean
}

const MODELS: ModelOption[] = [
  {
    id: 'openai_whisper-base',
    name: 'Whisper Base',
    description: 'Fastest, great quality, English only',
    size: '~150 MB',
    quality: 'Basic',
    speed: 'Very Fast',
    bundled: false,
    huggingfaceFolder: 'openai_whisper-base',
    macOSOnly: true
  },
  {
    id: 'parakeet_v2',
    name: 'Parakeet English',
    description: 'Fast, great quality, English only (Recommended)',
    size: '~600 MB',
    quality: 'Excellent',
    speed: 'Very Fast',
    bundled: false,
    huggingfaceFolder: 'parakeet-tdt-0.6b-v2-coreml',
    macOSOnly: true,
    isDefault: true
  },
  {
    id: 'parakeet_v3',
    name: 'Parakeet Multilingual',
    description: 'Fastest multilingual, great quality',
    size: '~600 MB',
    quality: 'Excellent',
    speed: 'Fast',
    bundled: false,
    huggingfaceFolder: 'parakeet-tdt-0.6b-v3-coreml',
    macOSOnly: true
  },
  {
    id: 'openai_whisper-large-v3-v20240930_turbo_632MB',
    name: 'Whisper Turbo',
    description: 'Fast, multilingual, best quality',
    size: '~632 MB',
    quality: 'Excellent',
    speed: 'Fast',
    bundled: false,
    huggingfaceFolder: 'openai_whisper-large-v3-v20240930_turbo_632MB',
    macOSOnly: true
  }
]

interface DownloadProgress {
  modelId: string
  percent: number
  downloadedFormatted: string
  totalFormatted: string
}

export function ModelSelectorDialog({
  isOpen,
  onClose,
  onSave,
  currentModelId,
  theme = lightTheme
}: ModelSelectorDialogProps): React.ReactElement<any> | null {
  const [selectedModelId, setSelectedModelId] = useState(currentModelId)
  // No models are bundled - all must be downloaded
  const [installedModels, setInstalledModels] = useState<Set<string>>(new Set())
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [switching] = useState(false)
  const [isMacOS, setIsMacOS] = useState(true) // Default to true, will check on mount

  const loadInstalledModels = useCallback(async (): Promise<void> => {
    try {
      if (window.bridge?.getInstalledModels) {
        const models = await window.bridge.getInstalledModels()
        setInstalledModels(new Set(models))
      }
    } catch (err) {
      console.error('Failed to load installed models:', err)
      setInstalledModels(new Set())
    }
  }, [])

  useEffect(() => {
    // Check platform on mount
    const checkPlatform = async (): Promise<void> => {
      try {
        if (window.bridge?.getPlatformInfo) {
          const info = await window.bridge.getPlatformInfo()
          setIsMacOS(info.platform === 'darwin')
        }
      } catch (err) {
        console.error('Failed to get platform info:', err)
        // Default to showing all models if we can't detect platform
        setIsMacOS(true)
      }
    }
    checkPlatform()
  }, [])

  useEffect(() => {
    if (isOpen) {
      loadInstalledModels()
      setSelectedModelId(currentModelId)
      setError(null)
    }
  }, [isOpen, currentModelId, loadInstalledModels])

  const handleDownload = async (modelId: string): Promise<void> => {
    try {
      setError(null)
      setDownloadingModel(modelId)
      setDownloadProgress(null)

      if (window.bridge?.downloadModel) {
        await window.bridge.downloadModel(modelId)
        await loadInstalledModels()
      }
    } catch (err) {
      console.error('Download failed:', err)
      setError(`Failed to download ${MODELS.find((m) => m.id === modelId)?.name}: ${err}`)
    } finally {
      setDownloadingModel(null)
      setDownloadProgress(null)
    }
  }

  const handleDelete = async (modelId: string): Promise<void> => {
    if (modelId === currentModelId) {
      setError('Cannot delete the currently active model')
      return
    }

    try {
      setError(null)
      if (window.bridge?.deleteModel) {
        await window.bridge.deleteModel(modelId)
        await loadInstalledModels()
        if (selectedModelId === modelId) {
          setSelectedModelId('openai_whisper-base')
        }
      }
    } catch (err) {
      console.error('Delete failed:', err)
      setError(`Failed to delete model: ${err}`)
    }
  }

  const handleSave = async (): Promise<void> => {
    if (selectedModelId === currentModelId) {
      onClose()
      return
    }

    // Close dialog immediately and switch in background
    onSave(selectedModelId)
    onClose()

    // Start the switch in the background (non-blocking)
    if (window.bridge?.switchModel) {
      window.bridge.switchModel(selectedModelId).catch((err) => {
        console.error('Background model switch failed:', err)
        // Error will be handled by main process, user will see fallback behavior
      })
    }
  }

  const handleOpenModelsFolder = async (): Promise<void> => {
    try {
      if (window.bridge?.openModelsFolder) {
        await window.bridge.openModelsFolder()
      }
    } catch (err) {
      console.error('Failed to open models folder:', err)
    }
  }

  const [isAnimating, setIsAnimating] = useState(false)
  const [shouldRender, setShouldRender] = useState(false)

  useEffect(() => {
    if (!isOpen) return

    // Listen for download progress
    const removeListener = window.bridge?.onDownloadProgress?.((progress: DownloadProgress) => {
      setDownloadProgress(progress)
    })

    return () => {
      if (removeListener) removeListener()
    }
  }, [isOpen])

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

  const handleClose = useCallback(() => {
    if (!downloadingModel && !switching) {
      onClose()
    }
  }, [onClose, downloadingModel, switching])

  if (!shouldRender) return null

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
          padding: '32px',
          minWidth: '560px',
          maxWidth: '640px',
          maxHeight: '80vh',
          transform: isAnimating ? 'scale(1) translateY(0)' : 'scale(0.96) translateY(8px)',
          transition: `transform ${DIALOG_ANIMATION_DURATION}ms ease-out`,
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.35)',
          border: `1px solid ${theme.modalBorder}`
        }}
      >
        <h2
          style={{
            color: theme.text,
            fontSize: '20px',
            fontWeight: '600',
            margin: 0,
            flexShrink: 0,
            fontFamily:
              'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
          }}
        >
          Select Model
        </h2>

        {/* Model Cards - Scrollable */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            overflowY: 'auto',
            flex: 1,
            paddingRight: '8px'
          }}
        >
          {MODELS.filter((model) => !model.macOSOnly || isMacOS).map((model) => {
            const isInstalled = installedModels.has(model.id)
            const isSelected = selectedModelId === model.id
            const isDownloading = downloadingModel === model.id
            const isCurrent = currentModelId === model.id
            const showProgress = isDownloading && downloadProgress?.modelId === model.id

            return (
              <div
                key={model.id}
                style={{
                  background: isSelected ? theme.selectionBg : 'transparent',
                  border: `1px solid ${isSelected ? theme.text : theme.border}`,
                  borderRadius: '12px',
                  padding: '16px',
                  cursor: isInstalled ? 'pointer' : 'default',
                  transition: 'all 0.15s ease',
                  opacity: !isInstalled && !isDownloading ? 0.6 : 1
                }}
                onClick={() => {
                  if (isInstalled && !isDownloading && !switching) {
                    setSelectedModelId(model.id)
                  }
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                  {/* Radio Button */}
                  <div
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      border: `1.5px solid ${isSelected ? theme.text : theme.textDisabled}`,
                      background: 'transparent',
                      flexShrink: 0,
                      marginTop: '2px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.15s'
                    }}
                  >
                    {isSelected && (
                      <div
                        style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          background: theme.text
                        }}
                      />
                    )}
                  </div>

                  {/* Model Info */}
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '4px'
                      }}
                    >
                      <h3
                        style={{
                          color: theme.text,
                          fontSize: '18px',
                          fontWeight: '600',
                          margin: 0
                        }}
                      >
                        {model.name}
                      </h3>
                      {model.isDefault && (
                        <span
                          style={{
                            background: theme.surface,
                            color: theme.textSecondary,
                            fontSize: '11px',
                            fontWeight: '600',
                            padding: '2px 8px',
                            borderRadius: '6px',
                            textTransform: 'uppercase',
                            border: `1px solid ${theme.border}`
                          }}
                        >
                          DEFAULT
                        </span>
                      )}
                      {model.id === 'parakeet_v2' && (
                        <span
                          style={{
                            background: theme.surface,
                            color: theme.textSecondary,
                            fontSize: '11px',
                            fontWeight: '600',
                            padding: '2px 8px',
                            borderRadius: '6px',
                            textTransform: 'uppercase',
                            border: `1px solid ${theme.border}`
                          }}
                        >
                          RECOMMENDED
                        </span>
                      )}
                    </div>
                    <p
                      style={{
                        color: theme.textSecondary,
                        fontSize: '14px',
                        margin: '0 0 12px 0'
                      }}
                    >
                      {model.description}
                    </p>
                    <div
                      style={{
                        display: 'flex',
                        gap: '16px',
                        fontSize: '13px',
                        color: theme.textSecondary
                      }}
                    >
                      <span>{model.size}</span>
                      <span>{model.quality}</span>
                      <span>{model.speed}</span>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {isInstalled ? (
                      <>
                        <div
                          style={{
                            padding: '4px 10px',
                            borderRadius: '6px',
                            background: 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: theme.textSecondary,
                            fontSize: '12px',
                            fontWeight: '500',
                            border: `1px solid ${theme.border}`
                          }}
                        >
                          Installed
                        </div>
                        {!model.bundled && !isCurrent && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDelete(model.id)
                            }}
                            disabled={switching}
                            style={{
                              width: '28px',
                              height: '28px',
                              borderRadius: '6px',
                              background: 'transparent',
                              border: 'none',
                              color: theme.textSecondary,
                              fontSize: '16px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'background 0.15s ease'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = theme.border
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'transparent'
                            }}
                          >
                            ×
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDownload(model.id)
                        }}
                        disabled={isDownloading || switching}
                        style={{
                          padding: '6px 14px',
                          borderRadius: '6px',
                          background: 'transparent',
                          border: `1px solid ${theme.border}`,
                          color: isDownloading ? theme.textSecondary : theme.text,
                          fontSize: '13px',
                          fontWeight: '500',
                          cursor: isDownloading ? 'not-allowed' : 'pointer',
                          transition: 'background 0.15s ease',
                          whiteSpace: 'nowrap'
                        }}
                        onMouseEnter={(e) => {
                          if (!isDownloading) {
                            e.currentTarget.style.background = theme.surface
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isDownloading) {
                            e.currentTarget.style.background = 'transparent'
                          }
                        }}
                      >
                        {isDownloading ? 'Downloading...' : 'Download'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                {showProgress && downloadProgress && (
                  <div style={{ marginTop: '16px' }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: '8px',
                        fontSize: '12px',
                        color: theme.textSecondary
                      }}
                    >
                      <span>Downloading...</span>
                      <span>
                        {downloadProgress.downloadedFormatted} / {downloadProgress.totalFormatted} (
                        {downloadProgress.percent}%)
                      </span>
                    </div>
                    <div
                      style={{
                        width: '100%',
                        height: '6px',
                        background: theme.border,
                        borderRadius: '3px',
                        overflow: 'hidden'
                      }}
                    >
                      <div
                        style={{
                          width: `${downloadProgress.percent}%`,
                          height: '100%',
                          background: theme.accent,
                          transition: 'width 0.3s ease'
                        }}
                      />
                    </div>
                    <p
                      style={{
                        fontSize: '11px',
                        color: theme.textSecondary,
                        marginTop: '8px',
                        lineHeight: '1.4'
                      }}
                    >
                      You can close this dialog — download will continue in the background. Whisper
                      Base will be used for transcription until this model is ready.
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Error Message */}
        {error && (
          <div
            style={{
              padding: '12px',
              borderRadius: '8px',
              background: 'rgba(255, 59, 48, 0.1)',
              border: '1px solid rgba(255, 59, 48, 0.3)',
              color: '#ff3b30',
              fontSize: '13px'
            }}
          >
            {error}
          </div>
        )}

        {/* Switching Message */}
        {switching && (
          <div
            style={{
              padding: '12px',
              borderRadius: '8px',
              background: theme.modalSurface,
              border: `1px solid ${theme.border}`,
              color: theme.text,
              fontSize: '13px',
              textAlign: 'center'
            }}
          >
            Switching model...
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={handleOpenModelsFolder}
            disabled={switching || downloadingModel !== null}
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 500,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: theme.text,
              background: 'transparent',
              border: 'none',
              cursor: switching || downloadingModel !== null ? 'not-allowed' : 'pointer',
              opacity: switching || downloadingModel !== null ? 0.5 : 1,
              transition: 'background 0.15s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.border
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            Open Models Folder
          </button>
          <button
            onClick={onClose}
            disabled={switching}
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 500,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: theme.text,
              background: 'transparent',
              border: 'none',
              cursor: switching ? 'not-allowed' : 'pointer',
              opacity: switching ? 0.5 : 1,
              transition: 'background 0.15s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.border
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {downloadingModel ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={handleSave}
            disabled={
              switching || downloadingModel !== null || !installedModels.has(selectedModelId)
            }
            style={{
              padding: '10px 16px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 500,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color:
                !switching && !downloadingModel && installedModels.has(selectedModelId)
                  ? theme.toggleThumb
                  : theme.textDisabled,
              background:
                !switching && !downloadingModel && installedModels.has(selectedModelId)
                  ? theme.buttonBg
                  : 'transparent',
              border: 'none',
              cursor:
                switching || downloadingModel !== null || !installedModels.has(selectedModelId)
                  ? 'not-allowed'
                  : 'pointer',
              opacity:
                switching || downloadingModel !== null || !installedModels.has(selectedModelId)
                  ? 0.5
                  : 1,
              transition: 'background 0.15s ease'
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
