import type {
  ChangeEventHandler,
  KeyboardEventHandler,
  ReactNode,
  RefObject,
} from 'react'
import { Search } from 'lucide-react'
import type { PanelTheme } from '../../hooks/usePanelTheme'

interface PanelSidebarActionGridProps {
  children: ReactNode
}

export function PanelSidebarActionGrid({
  children,
}: PanelSidebarActionGridProps): React.ReactElement<any> {
  return (
    <div style={{ padding: '10px 10px 6px' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 6,
        }}
      >
        {children}
      </div>
    </div>
  )
}

interface PanelSidebarActionButtonProps {
  title: string
  theme: PanelTheme
  active?: boolean
  disabled?: boolean
  onClick(): void
  children: ReactNode
}

export function PanelSidebarActionButton({
  title,
  theme,
  active = false,
  disabled = false,
  onClick,
  children,
}: PanelSidebarActionButtonProps): React.ReactElement<any> {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        height: 32,
        minWidth: 0,
        borderRadius: 8,
        border: `1px solid ${theme.border}`,
        background: active ? theme.sidebarItemActive : theme.surfaceBg,
        color: active ? theme.text : theme.iconColorMuted,
        cursor: disabled ? 'not-allowed' : 'default',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 0.15s ease, opacity 0.15s ease',
        opacity: disabled ? 0.45 : 1,
      }}
      onMouseEnter={(event) => {
        if (!disabled && !active) event.currentTarget.style.background = theme.surfaceBgHover
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = active
          ? theme.sidebarItemActive
          : theme.surfaceBg
      }}
    >
      {children}
    </button>
  )
}

interface PanelSidebarSearchProps {
  value: string
  placeholder: string
  theme: PanelTheme
  collapsed?: boolean
  inputRef?: RefObject<HTMLInputElement | null>
  onChange: ChangeEventHandler<HTMLInputElement>
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>
}

export function PanelSidebarSearch({
  value,
  placeholder,
  theme,
  collapsed = false,
  inputRef,
  onChange,
  onKeyDown,
}: PanelSidebarSearchProps): React.ReactElement<any> {
  return (
    <div style={{ padding: collapsed ? '10px 10px 6px' : '0 10px 6px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: theme.surfaceBg,
          borderRadius: 9,
          padding: '7px 11px',
          border: `1px solid ${theme.border}`,
        }}
      >
        <Search size={14} color={theme.iconColorMuted} style={{ flexShrink: 0 }} />
        {collapsed ? null : (
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={onChange}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            style={{
              flex: 1,
              minWidth: 0,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              boxShadow: 'none',
              padding: 0,
              fontSize: 13,
              lineHeight: '18px',
              color: theme.text,
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
          />
        )}
      </div>
    </div>
  )
}
