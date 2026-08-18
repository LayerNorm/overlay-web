import { X, Command } from 'lucide-react'
import { PanelTheme } from '../hooks/usePanelTheme'

interface Shortcut {
  keys: string[]
  description: string
}

interface ShortcutsMenuProps {
  isOpen: boolean
  onClose: () => void
  shortcuts: Shortcut[]
  theme: PanelTheme
  title?: string
}

export function ShortcutsMenu({
  isOpen,
  onClose,
  shortcuts,
  theme,
  title = 'Keyboard Shortcuts'
}: ShortcutsMenuProps): React.ReactElement<any> | null {
  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(4px)',
          zIndex: 200
        }}
      />

      {/* Menu */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: theme.dropdownBg,
          border: `1px solid ${theme.border}`,
          borderRadius: 12,
          padding: 16,
          zIndex: 201,
          minWidth: 280,
          maxWidth: '90%',
          maxHeight: '80%',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          animation: 'fadeIn 0.15s ease-out'
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
            paddingBottom: 12,
            borderBottom: `1px solid ${theme.border}`,
            flexShrink: 0
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: theme.text,
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}
          >
            {title}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 4,
              cursor: 'pointer',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.surfaceBgHover
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <X size={14} color={theme.iconColorMuted} />
          </button>
        </div>

        {/* Shortcuts list */}
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', flex: 1 }}
        >
          {shortcuts.map((shortcut, index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  color: theme.textSecondary,
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  flex: 1,
                  minWidth: 0
                }}
              >
                {shortcut.description}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                {shortcut.keys.map((key, keyIndex) => (
                  <span
                    key={keyIndex}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    {keyIndex > 0 && (
                      <span
                        style={{
                          color: theme.textMuted,
                          fontSize: 10
                        }}
                      >
                        +
                      </span>
                    )}
                    <kbd
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '3px 6px',
                        fontSize: 11,
                        fontFamily: 'system-ui, -apple-system, sans-serif',
                        fontWeight: 500,
                        color: theme.text,
                        background: theme.surfaceBg,
                        border: `1px solid ${theme.border}`,
                        borderRadius: 4,
                        minWidth: 22,
                        boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
                      }}
                    >
                      {key === '⌘' ? <Command size={11} /> : key}
                    </kbd>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div
          style={{
            marginTop: 16,
            paddingTop: 12,
            borderTop: `1px solid ${theme.border}`,
            textAlign: 'center',
            fontSize: 11,
            color: theme.textMuted,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            flexShrink: 0
          }}
        >
          Press Esc to close
        </div>
      </div>

      {/* Animation keyframes */}
      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
        }
      `}</style>
    </>
  )
}
