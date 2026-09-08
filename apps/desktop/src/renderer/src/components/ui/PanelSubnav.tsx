import type { ComponentType, CSSProperties, ReactElement } from 'react'
import type { Theme } from '../../utils/theme'

export interface PanelSubnavItem {
  id: string
  label: string
  icon: ComponentType<{ size?: number; color?: string; style?: CSSProperties }>
  badgeCount?: number
}

interface PanelSubnavProps {
  items: readonly PanelSubnavItem[]
  activeId: string
  onSelect: (id: string) => void
  theme: Theme
}

/**
 * Secondary-panel subnavigation (Chats → Personal/DMs/…, Files → All/Notes/…).
 * Mirrors the web `InlineNavChildren`: icon rows under the panel header that
 * switch the list subview without leaving the surface.
 */
export function PanelSubnav({ items, activeId, onSelect, theme }: PanelSubnavProps): ReactElement<any> {
  return (
    <div
      role="tablist"
      aria-label="Section views"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1px',
        padding: '6px 8px 4px',
        flexShrink: 0
      }}
    >
      {items.map(({ id, label, icon: Icon, badgeCount }) => {
        const active = id === activeId
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              if (!active) onSelect(id)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              width: '100%',
              height: '28px',
              padding: '0 10px',
              boxSizing: 'border-box',
              border: 'none',
              borderRadius: '6px',
              background: active ? theme.selectionBg : 'transparent',
              color: active ? theme.selectionText : theme.textSecondary,
              cursor: active ? 'default' : 'pointer',
              fontSize: '12px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              textAlign: 'left',
              transition: 'background 0.1s ease'
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = theme.buttonHover
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = 'transparent'
            }}
          >
            <Icon size={13} color="currentColor" style={{ flexShrink: 0 }} />
            <span
              style={{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {label}
            </span>
            {badgeCount !== undefined && badgeCount > 0 && (
              <span
                style={{
                  minWidth: '16px',
                  height: '16px',
                  padding: '0 4px',
                  boxSizing: 'border-box',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '9999px',
                  background: theme.border,
                  color: theme.text,
                  fontSize: '9px',
                  fontWeight: 600
                }}
              >
                {badgeCount > 9 ? '9+' : badgeCount}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
