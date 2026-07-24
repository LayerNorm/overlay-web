import { useState, useEffect, ReactElement } from 'react'
import { Trash2, Pencil, Check, X, Plus, RotateCcw, FolderOpen } from 'lucide-react'
import { SettingsRow } from '../ui/SettingsRow'
import { Toggle } from '../ui/Toggle'
import { ModelSelectorDialog } from './ModelSelectorDialog'
import {
  Settings,
  SmartTranscriptionMode,
  DEFAULT_SMART_TRANSCRIPTION_PROMPT
} from '../../hooks/useSettings'
import { Theme } from '../../utils/theme'

interface TranscriptionSettingsProps {
  settings: Settings
  onUpdateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  theme: Theme
}

export function TranscriptionSettings({
  settings,
  onUpdateSetting,
  theme
}: TranscriptionSettingsProps): ReactElement {
  const [showModelSelector, setShowModelSelector] = useState(false)
  const [currentModelName, setCurrentModelName] = useState('Base')
  const [editingModeId, setEditingModeId] = useState<string | null>(null)
  const [editingModeName, setEditingModeName] = useState('')
  const [editingModePrompt, setEditingModePrompt] = useState('')
  const [isCreatingMode, setIsCreatingMode] = useState(false)

  // Map model IDs to display names
  const getModelDisplayName = (modelId: string): string => {
    const nameMap: Record<string, string> = {
      parakeet_v2: 'Parakeet v2',
      parakeet_v3: 'Parakeet v3',
      'openai_whisper-base': 'Whisper Base',
      'openai_whisper-large-v3-v20240930_turbo_632MB': 'Whisper Turbo',
      'openai_whisper-large-v3_947MB': 'Whisper Large'
    }
    return nameMap[modelId] || modelId
  }

  useEffect(() => {
    // Update display name when selectedModel changes
    if (settings.selectedModel) {
      setCurrentModelName(getModelDisplayName(settings.selectedModel))
    }
  }, [settings.selectedModel])

  // Mode management handlers
  const handleStartEditMode = (mode: SmartTranscriptionMode): void => {
    setEditingModeId(mode.id)
    setEditingModeName(mode.name)
    setEditingModePrompt(mode.prompt)
  }

  const handleCancelEditMode = (): void => {
    setEditingModeId(null)
    setEditingModeName('')
    setEditingModePrompt('')
    setIsCreatingMode(false)
  }

  const handleSaveMode = (): void => {
    if (!editingModeName.trim()) return

    const modes = settings.smartTranscriptionModes || []

    if (isCreatingMode) {
      const newMode: SmartTranscriptionMode = {
        id: `mode-${Date.now()}`,
        name: editingModeName.trim(),
        prompt: editingModePrompt.trim(),
        isDefault: false
      }
      onUpdateSetting('smartTranscriptionModes', [...modes, newMode])
    } else if (editingModeId) {
      const updatedModes = modes.map((m) =>
        m.id === editingModeId
          ? { ...m, name: editingModeName.trim(), prompt: editingModePrompt.trim() }
          : m
      )
      onUpdateSetting('smartTranscriptionModes', updatedModes)
    }

    handleCancelEditMode()
  }

  const handleDeleteMode = (modeId: string): void => {
    const modes = settings.smartTranscriptionModes || []
    const updatedModes = modes.filter((m) => m.id !== modeId)
    onUpdateSetting('smartTranscriptionModes', updatedModes)

    // If deleted mode was active, switch to default
    if (settings.activeSmartTranscriptionModeId === modeId) {
      onUpdateSetting('activeSmartTranscriptionModeId', 'default')
    }
  }

  const handleRestoreDefaultPrompt = (): void => {
    const modes = settings.smartTranscriptionModes || []
    const updatedModes = modes.map((m) =>
      m.id === 'default' ? { ...m, prompt: DEFAULT_SMART_TRANSCRIPTION_PROMPT } : m
    )
    onUpdateSetting('smartTranscriptionModes', updatedModes)
  }

  // Check if default mode prompt has been modified
  const isDefaultModeModified = (): boolean => {
    const defaultMode = (settings.smartTranscriptionModes || []).find((m) => m.id === 'default')
    return defaultMode?.prompt !== DEFAULT_SMART_TRANSCRIPTION_PROMPT
  }

  const handleStartCreateMode = (): void => {
    setIsCreatingMode(true)
    setEditingModeId('new')
    setEditingModeName('')
    setEditingModePrompt('')
  }

  const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: '8px 12px',
    background: 'rgba(255, 255, 255, 0.05)',
    border: `1px solid ${theme.border}`,
    borderRadius: 8,
    color: theme.text,
    fontSize: 13,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    outline: 'none'
  }

  const textareaStyle: React.CSSProperties = {
    ...inputStyle,
    minHeight: 80,
    resize: 'vertical' as const
  }

  const iconButtonStyle: React.CSSProperties = {
    padding: 6,
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: theme.textSecondary,
    transition: 'all 0.15s ease'
  }

  return (
    <>
      <div>
        <SettingsRow
          title="Transcription Priority"
          description={
            settings.transcriptionPriority === 'cloud'
              ? 'Cloud first, local as backup'
              : 'Local first, cloud as backup'
          }
          theme={theme}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                fontSize: '13px',
                color:
                  settings.transcriptionPriority === 'local' ? theme.text : theme.textSecondary,
                fontWeight: settings.transcriptionPriority === 'local' ? 600 : 400
              }}
            >
              Local
            </span>
            <Toggle
              checked={settings.transcriptionPriority === 'cloud'}
              onChange={(val) => {
                const priority = val ? 'cloud' : 'local'
                onUpdateSetting('transcriptionPriority', priority)
                // Update both settings to maintain backward compatibility
                onUpdateSetting('cloudTranscription', val)
                onUpdateSetting('localTranscription', !val)
                if (window.bridge?.updateTranscriptionPriority) {
                  window.bridge.updateTranscriptionPriority(priority)
                }
              }}
              theme={theme}
            />
            <span
              style={{
                fontSize: '13px',
                color:
                  settings.transcriptionPriority === 'cloud' ? theme.text : theme.textSecondary,
                fontWeight: settings.transcriptionPriority === 'cloud' ? 600 : 400
              }}
            >
              Cloud
            </span>
          </div>
        </SettingsRow>

        <SettingsRow
          title="Local Model"
          description="Select offline transcription model"
          theme={theme}
        >
          <button
            onClick={() => setShowModelSelector(true)}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: theme.text,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'background 0.15s ease',
              textDecoration: 'underline',
              textDecorationThickness: '2px',
              textUnderlineOffset: '3px'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.border
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {currentModelName}
          </button>
        </SettingsRow>

        {/* Smart Transcription Section */}
        <div style={{ marginTop: 0 }}>
          <SettingsRow
            title="Enable Smart Transcription"
            description="Process transcriptions through AI for enhanced formatting"
            theme={theme}
          >
            <Toggle
              checked={settings.smartTranscription}
              onChange={(val) => {
                onUpdateSetting('smartTranscription', val)
                void window.bridge?.updateSmartTranscription?.(val)
              }}
              theme={theme}
            />
          </SettingsRow>

          {settings.smartTranscription && (
            <>
              {/* Active Mode Selector */}
              <SettingsRow
                title="Active Mode"
                description="Select which transcription mode to use"
                theme={theme}
              >
                <select
                  value={settings.activeSmartTranscriptionModeId || 'default'}
                  onChange={(e) =>
                    onUpdateSetting('activeSmartTranscriptionModeId', e.target.value)
                  }
                  style={{
                    padding: '6px 12px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: `1px solid ${theme.border}`,
                    borderRadius: 8,
                    color: theme.text,
                    fontSize: 13,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  {(settings.smartTranscriptionModes || []).map((mode) => (
                    <option key={mode.id} value={mode.id}>
                      {mode.name}
                    </option>
                  ))}
                </select>
              </SettingsRow>

              {/* Modes List */}
              <div style={{ marginTop: 16 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 12
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: theme.text,
                      fontFamily: 'system-ui, -apple-system, sans-serif'
                    }}
                  >
                    Transcription Modes
                  </span>
                  <button
                    onClick={handleStartCreateMode}
                    style={{
                      padding: '6px 14px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                      color: theme.text,
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                      textDecoration: 'underline',
                      textDecorationThickness: '2px',
                      textUnderlineOffset: '3px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = theme.border
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <Plus size={14} />
                    Add Mode
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {(settings.smartTranscriptionModes || []).map((mode) => (
                    <div
                      key={mode.id}
                      style={{
                        padding: 12,
                        background: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: 10,
                        border: `1px solid ${theme.border}`
                      }}
                    >
                      {editingModeId === mode.id ? (
                        // Edit mode
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <input
                            type="text"
                            value={editingModeName}
                            onChange={(e) => setEditingModeName(e.target.value)}
                            placeholder="Mode name"
                            autoFocus
                            style={inputStyle}
                          />
                          <textarea
                            value={editingModePrompt}
                            onChange={(e) => setEditingModePrompt(e.target.value)}
                            placeholder="Custom instructions for this mode (optional). Leave empty to use default formatting."
                            style={textareaStyle}
                          />
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button
                              onClick={handleCancelEditMode}
                              style={{ ...iconButtonStyle, color: '#ef4444' }}
                              title="Cancel"
                            >
                              <X size={16} />
                            </button>
                            <button
                              onClick={handleSaveMode}
                              style={{ ...iconButtonStyle, color: '#10b981' }}
                              title="Save"
                            >
                              <Check size={16} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        // View mode
                        <div>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between'
                            }}
                          >
                            <div>
                              <span
                                style={{
                                  fontSize: 13,
                                  fontWeight: 500,
                                  color: theme.text,
                                  fontFamily: 'system-ui, -apple-system, sans-serif'
                                }}
                              >
                                {mode.name}
                                {mode.isDefault && (
                                  <span
                                    style={{
                                      marginLeft: 8,
                                      fontSize: 11,
                                      color: theme.textSecondary,
                                      background: 'rgba(255, 255, 255, 0.1)',
                                      padding: '2px 6px',
                                      borderRadius: 4
                                    }}
                                  >
                                    Default
                                  </span>
                                )}
                              </span>
                              {mode.prompt && (
                                <p
                                  style={{
                                    fontSize: 11,
                                    color: theme.textSecondary,
                                    marginTop: 4,
                                    fontFamily: 'system-ui, -apple-system, sans-serif',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    maxWidth: 300
                                  }}
                                >
                                  {mode.prompt}
                                </p>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 4 }}>
                              {mode.isDefault && isDefaultModeModified() && (
                                <button
                                  onClick={handleRestoreDefaultPrompt}
                                  style={{ ...iconButtonStyle, color: '#f59e0b' }}
                                  title="Restore default prompt"
                                >
                                  <RotateCcw size={16} />
                                </button>
                              )}
                              <button
                                onClick={() => handleStartEditMode(mode)}
                                style={iconButtonStyle}
                                title="Edit mode"
                              >
                                <Pencil size={16} />
                              </button>
                              {!mode.isDefault && (
                                <button
                                  onClick={() => handleDeleteMode(mode.id)}
                                  style={{ ...iconButtonStyle, color: '#ef4444' }}
                                  title="Delete mode"
                                >
                                  <Trash2 size={16} />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {/* New mode form */}
                  {isCreatingMode && (
                    <div
                      style={{
                        padding: 12,
                        background: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: 10,
                        border: `1px solid ${theme.border}`
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <input
                          type="text"
                          value={editingModeName}
                          onChange={(e) => setEditingModeName(e.target.value)}
                          placeholder="Mode name"
                          autoFocus
                          style={inputStyle}
                        />
                        <textarea
                          value={editingModePrompt}
                          onChange={(e) => setEditingModePrompt(e.target.value)}
                          placeholder="Custom instructions for this mode (optional). Example: 'Always use formal language and proper punctuation.'"
                          style={textareaStyle}
                        />
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button
                            onClick={handleCancelEditMode}
                            style={{ ...iconButtonStyle, color: '#ef4444' }}
                            title="Cancel"
                          >
                            <X size={16} />
                          </button>
                          <button
                            onClick={handleSaveMode}
                            disabled={!editingModeName.trim()}
                            style={{
                              ...iconButtonStyle,
                              color: editingModeName.trim() ? '#10b981' : theme.textSecondary
                            }}
                            title="Save"
                          >
                            <Check size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: theme.text,
            marginBottom: 12,
            fontFamily: 'system-ui, -apple-system, sans-serif'
          }}
        >
          Recording Storage
        </div>

        <SettingsRow
          title="Store Recordings"
          description="Save a copy of each recording to this device"
          theme={theme}
        >
          <Toggle
            checked={settings.recordingStorageEnabled}
            onChange={(val) => {
              onUpdateSetting('recordingStorageEnabled', val)
              void window.bridge?.updateRecordingStorage?.(val)
            }}
            theme={theme}
          />
        </SettingsRow>

        <SettingsRow
          title="Keep recordings for"
          description="Older recordings are automatically deleted"
          theme={theme}
        >
          <select
            value={settings.recordingStorageRetention}
            disabled={!settings.recordingStorageEnabled}
            onChange={(e) => {
              const retention = e.target.value as '24h' | '7d' | '30d'
              onUpdateSetting('recordingStorageRetention', retention)
              void window.bridge?.updateRecordingRetention?.(retention)
            }}
            style={{
              padding: '6px 12px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: `1px solid ${theme.border}`,
              borderRadius: 8,
              color: theme.text,
              fontSize: 13,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              outline: 'none',
              cursor: settings.recordingStorageEnabled ? 'pointer' : 'not-allowed',
              opacity: settings.recordingStorageEnabled ? 1 : 0.5
            }}
          >
            <option value="24h">24 hours</option>
            <option value="7d">Last week</option>
            <option value="30d">Last month</option>
          </select>
        </SettingsRow>

        <SettingsRow
          title="Saved recordings"
          description="Open the folder where recordings are stored"
          theme={theme}
        >
          <button
            onClick={() => {
              void window.bridge?.openRecordingsFolder?.()
            }}
            disabled={!settings.recordingStorageEnabled}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 8,
              background: 'rgba(255, 255, 255, 0.05)',
              border: `1px solid ${theme.border}`,
              color: theme.text,
              fontSize: 13,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              cursor: settings.recordingStorageEnabled ? 'pointer' : 'not-allowed',
              opacity: settings.recordingStorageEnabled ? 1 : 0.5,
              transition: 'background 0.15s ease'
            }}
            onMouseEnter={(e) => {
              if (settings.recordingStorageEnabled) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
            }}
          >
            <FolderOpen size={14} />
            <span>Show in Finder</span>
          </button>
        </SettingsRow>
      </div>

      <ModelSelectorDialog
        isOpen={showModelSelector}
        onClose={() => setShowModelSelector(false)}
        onSave={(modelId) => {
          onUpdateSetting('selectedModel', modelId)
          setCurrentModelName(getModelDisplayName(modelId))
        }}
        currentModelId={settings.selectedModel || 'openai_whisper-base'}
        theme={theme}
      />
    </>
  )
}
