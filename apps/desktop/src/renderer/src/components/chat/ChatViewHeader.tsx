import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { PanelTheme } from '../../hooks/usePanelTheme'
import type { ChatModel } from './types'
import { ModelDropdown } from './ModelDropdown'

export interface ChatViewHeaderProps {
  title: string
  theme: PanelTheme
  models: ChatModel[]
  selectedModels: ChatModel[]
  setSelectedModels: (models: ChatModel[]) => void
  /** Allow the single/multiple selection toggle (disabled for automations). */
  allowMultiSelect?: boolean
  isAgentMode?: boolean
  containerRef?: React.RefObject<HTMLElement | null>
  leftSlot?: ReactNode
}

/**
 * Chat view header matching the MainWindow extensions header: 44px tall with a
 * bottom divider that lines up with the sidebar header divider. Hosts the
 * model dropdown (with single/multiple toggle) like the web shell header.
 */
export function ChatViewHeader({
  title,
  theme,
  models,
  selectedModels,
  setSelectedModels,
  allowMultiSelect = true,
  isAgentMode = false,
  containerRef,
  leftSlot
}: ChatViewHeaderProps): React.ReactElement<any> {
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showDropdown) return
    const handleOutside = (event: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setShowDropdown(false)
    }
    document.addEventListener('mousedown', handleOutside, true)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutside, true)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [showDropdown])

  return (
    <div
      style={{
        height: 44,
        borderBottom: `1px solid ${theme.border}`,
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        flexShrink: 0
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          minWidth: 0,
          flex: 1
        }}
      >
        {leftSlot}
        <h2
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 600,
            color: theme.text,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: 'system-ui, -apple-system, sans-serif'
          }}
        >
          {title}
        </h2>
      </div>
      <ModelDropdown
        models={models}
        selectedModels={selectedModels}
        showDropdown={showDropdown}
        setShowDropdown={setShowDropdown}
        setSelectedModels={setSelectedModels}
        dropdownRef={dropdownRef as React.RefObject<HTMLDivElement | null>}
        theme={theme}
        isAgentMode={isAgentMode}
        allowMultiSelect={allowMultiSelect}
        containerRef={containerRef}
      />
    </div>
  );
}
