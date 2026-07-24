import { SettingsRow } from '../ui/SettingsRow'
import { Toggle } from '../ui/Toggle'
import { Settings, PhrasePair } from '../../hooks/useSettings'
import { Theme } from '../../utils/theme'
import { useEffect, useState, ReactNode, ReactElement } from 'react'
import { PhraseReplacementDialog } from '../ui/PhraseReplacementDialog'

interface OutputSettingsProps {
  settings: Settings
  onUpdateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  theme: Theme
}

export function OutputSettings({
  settings,
  onUpdateSetting,
  theme
}: OutputSettingsProps): ReactElement {
  const [isPhraseDialogOpen, setIsPhraseDialogOpen] = useState(false)
  const [isDictionaryDialogOpen, setIsDictionaryDialogOpen] = useState(false)

  // Sync settings to main process on component mount
  useEffect(() => {
    if (window.bridge?.syncSettings) {
      window.bridge.syncSettings({
        autoCopy: settings.autoCopy,
        pressEnterAfter: settings.pressEnterAfter
      })
    }
  }, [settings.autoCopy, settings.pressEnterAfter])

  const handleAutoCopyChange = (val: boolean): void => {
    onUpdateSetting('autoCopy', val)
    if (window.bridge?.updateAutoCopy) {
      window.bridge.updateAutoCopy(val)
    }
  }

  const handlePressEnterAfterChange = (val: boolean): void => {
    onUpdateSetting('pressEnterAfter', val)
    if (window.bridge?.updatePressEnterAfter) {
      window.bridge.updatePressEnterAfter(val)
    }
  }

  const handleManagePhrases = (): void => {
    setIsPhraseDialogOpen(true)
  }

  const handlePhraseDialogClose = (): void => {
    setIsPhraseDialogOpen(false)
  }

  const handlePhraseDialogSave = (phrases: PhrasePair[]): void => {
    onUpdateSetting('phraseReplacements', phrases)
  }

  const handleDictionarySave = (words: string[]): void => {
    onUpdateSetting('dictionaryWords', words)
  }

  return (
    <>
      <div>
        <SettingsRow
          title="Auto Copy"
          description="Keep transcriptions in clipboard after pasting"
          theme={theme}
        >
          <Toggle checked={settings.autoCopy} onChange={handleAutoCopyChange} theme={theme} />
        </SettingsRow>

        <SettingsRow
          title="Press Enter After"
          description="Press Enter key automatically after pasting"
          theme={theme}
        >
          <Toggle
            checked={settings.pressEnterAfter}
            onChange={handlePressEnterAfterChange}
            theme={theme}
          />
        </SettingsRow>

        <SettingsRow
          title="Dictionary"
          description={`Custom words for better transcription (${settings.dictionaryWords?.length || 0} words)`}
          theme={theme}
        >
          <button
            onClick={() => setIsDictionaryDialogOpen(true)}
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
            Manage Words
          </button>
        </SettingsRow>

        <SettingsRow
          title="Phrase Replacements"
          description={`Replace phrases in transcriptions (${settings.phraseReplacements?.length || 0} rules)`}
          theme={theme}
        >
          <button
            onClick={handleManagePhrases}
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
            Manage Phrases
          </button>
        </SettingsRow>
      </div>

      <PhraseReplacementDialog
        isOpen={isPhraseDialogOpen}
        onClose={handlePhraseDialogClose}
        onSave={handlePhraseDialogSave}
        currentPhrases={settings.phraseReplacements || []}
        theme={theme}
      />

      <DictionaryDialog
        isOpen={isDictionaryDialogOpen}
        onClose={() => setIsDictionaryDialogOpen(false)}
        onSave={handleDictionarySave}
        currentWords={settings.dictionaryWords || []}
        theme={theme}
      />
    </>
  )
}

interface DictionaryDialogProps {
  isOpen: boolean
  onClose: () => void
  onSave: (words: string[]) => void
  currentWords: string[]
  theme: Theme
}

function DictionaryDialog({
  isOpen,
  onClose,
  onSave,
  currentWords,
  theme
}: DictionaryDialogProps): ReactElement | null {
  const [words, setWords] = useState<string[]>(currentWords)

  useEffect(() => {
    setWords(currentWords)
  }, [currentWords, isOpen])

  if (!isOpen) return null

  const handleAdd = (): void => setWords((prev) => [...prev, ''])
  const handleChange = (idx: number, value: string): void => {
    setWords((prev) => prev.map((w, i) => (i === idx ? value : w)))
  }
  const handleRemove = (idx: number): void => {
    setWords((prev) => prev.filter((_, i) => i !== idx))
  }
  const handleSave = (): void => {
    const cleaned = words.map((w) => w.trim()).filter((w) => w.length > 0)
    onSave(cleaned)
    onClose()
  }

  return (
    <ModalShell title="Dictionary" theme={theme} onClose={onClose} onSave={handleSave}>
      <p style={{ color: theme.textSecondary, margin: '0 0 12px 0' }}>
        Add words or names so the model spells them exactly.
      </p>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          maxHeight: '260px',
          overflowY: 'auto'
        }}
      >
        {words.map((word, idx) => (
          <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              value={word}
              onChange={(e) => handleChange(idx, e.target.value)}
              style={{
                flex: 1,
                padding: '10px 12px',
                borderRadius: '10px',
                border: `1px solid ${theme.border}`,
                background: theme.surface,
                color: theme.text
              }}
              placeholder="Enter word or phrase"
            />
            <button
              onClick={() => handleRemove(idx)}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '13px',
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
              Remove
            </button>
          </div>
        ))}
        <button
          onClick={handleAdd}
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: theme.text,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            transition: 'background 0.15s ease',
            alignSelf: 'flex-start'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = theme.border
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          + Add Word
        </button>
      </div>
    </ModalShell>
  )
}

interface ModalShellProps {
  title: string
  children: ReactNode
  theme: Theme
  onClose: () => void
  onSave: () => void
}

function ModalShell({ title, children, theme, onClose, onSave }: ModalShellProps): ReactElement {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: theme.scrim,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        overflow: 'hidden'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: theme.modalBackground,
          borderRadius: '16px',
          padding: '24px',
          width: '720px',
          maxWidth: '90vw',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
          border: `1px solid ${theme.modalBorder}`,
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, color: theme.text, fontSize: '20px' }}>{title}</h3>
          <button
            onClick={onClose}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: theme.textSecondary,
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
            ✕
          </button>
        </div>
        <div>{children}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 16px',
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
            onClick={onSave}
            style={{
              padding: '10px 16px',
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
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
