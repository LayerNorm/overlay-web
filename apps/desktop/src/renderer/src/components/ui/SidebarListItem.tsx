import {
  useState,
  type ReactElement,
  type ReactNode,
  type ComponentType,
  type CSSProperties,
  type MouseEvent
} from 'react'
import { CheckSquare, Square } from 'lucide-react'
import type { Theme } from '../../utils/theme'
import { resolveSidebarListItemColors } from './SidebarListItem.styles'

const ITEM_HEIGHT = 28
const ITEM_PADDING = '5px 10px'
const ITEM_GAP = 6
const ITEM_RADIUS = 6
const FONT_SIZE = 12
const LINE_HEIGHT = '18px'
const ICON_SIZE = 13
const ACTION_ICON_SIZE = 11

export interface SidebarListItemProps {
  /** Icon component to show on the left (when not in select mode). */
  icon?: ComponentType<{ size?: number; color?: string; style?: CSSProperties }>
  /** Override color for the icon. Defaults to theme.textSecondary. */
  iconColor?: string
  /** Extra props to pass through to the icon (e.g. strokeWidth). */
  iconProps?: { strokeWidth?: number; className?: string }
  /** Main label text. */
  label: string
  /** Click handler. In select mode, onBatchToggle is called instead. */
  onClick?: () => void
  /** Whether this item is the currently active/selected one. */
  isActive?: boolean
  /** Whether this item is batch-selected in select mode. */
  isBatchSelected?: boolean
  /** Whether the list is in multi-select mode. */
  isSelectMode?: boolean
  /** Called when the item is clicked in select mode. */
  onBatchToggle?: () => void
  /** Indentation depth (for tree structures). Each level adds 16px left padding. */
  depth?: number
  /** Optional content to show on the left, before the icon (e.g. expand chevron). */
  leading?: ReactNode
  /** Hover-revealed action buttons (delete, open in panel, etc.). */
  actions?: ReactNode
  /** HTML title attribute. */
  title?: string
  /** Theme object. */
  theme: Theme
}

/**
 * Shared primitive for sidebar list items across all list pages.
 * Ensures consistent height, padding, icon size, background colors, and text styling.
 */
export function SidebarListItem({
  icon: Icon,
  iconColor,
  iconProps,
  label,
  onClick,
  isActive = false,
  isBatchSelected = false,
  isSelectMode = false,
  onBatchToggle,
  depth = 0,
  leading,
  actions,
  title,
  theme
}: SidebarListItemProps): ReactElement<any> {
  const [hovered, setHovered] = useState(false)
  const { background, foreground } = resolveSidebarListItemColors({
    theme,
    isActive,
    isBatchSelected,
    isSelectMode,
    isHovered: hovered
  })

  const handleClick = (): void => {
    if (isSelectMode) {
      onBatchToggle?.()
    } else {
      onClick?.()
    }
  }

  return (
    <div
      title={title}
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: ITEM_GAP,
        padding: ITEM_PADDING,
        paddingLeft: 10 + depth * 16,
        borderRadius: ITEM_RADIUS,
        height: ITEM_HEIGHT,
        boxSizing: 'border-box',
        cursor: 'pointer',
        background,
        transition: 'background 0.1s ease',
        userSelect: 'none'
      }}
    >
      {isSelectMode && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {isBatchSelected ? (
            <CheckSquare size={ICON_SIZE} color={theme.selectionText} />
          ) : (
            <Square size={ICON_SIZE} color={theme.textSecondary} />
          )}
        </div>
      )}
      {leading && !isSelectMode && leading}
      {Icon && !isSelectMode && (
        <Icon
          size={ICON_SIZE}
          color={isActive ? theme.selectionText : (iconColor ?? theme.textSecondary)}
          style={{ flexShrink: 0 }}
          {...iconProps}
        />
      )}
      <span
        style={{
          flex: 1,
          fontSize: FONT_SIZE,
          color: foreground,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          lineHeight: LINE_HEIGHT
        }}
      >
        {label}
      </span>
      {!isSelectMode && actions && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flexShrink: 0,
            opacity: hovered || isActive ? 1 : 0,
            transition: 'opacity 0.1s ease'
          }}
        >
          {actions}
        </div>
      )}
    </div>
  )
}

/**
 * Hover-revealed action button for use inside SidebarListItem `actions` prop.
 */
export function SidebarItemAction({
  onClick,
  title,
  icon: Icon,
  color
}: {
  onClick: (e: MouseEvent) => void
  title: string
  icon: ComponentType<{ size?: number; color?: string }>
  color?: string
}): ReactElement<any> {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick(e)
      }}
      title={title}
      style={{
        background: 'transparent',
        border: 'none',
        padding: '2px',
        cursor: 'pointer',
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        color: color ?? 'inherit'
      }}
    >
      <Icon size={ACTION_ICON_SIZE} />
    </button>
  )
}
