import React, { useRef, useCallback } from 'react'
import { X } from 'lucide-react'
import { PanelTheme } from '../../hooks/usePanelTheme'

export interface Tab {
  id: string
  title: string
}

interface TabBarProps {
  tabs: Tab[]
  activeTabId: string
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  theme: PanelTheme
}

export function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  theme
}: TabBarProps): React.ReactElement | null {
  const containerRef = useRef<HTMLDivElement>(null)

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (containerRef.current) {
      e.preventDefault()
      containerRef.current.scrollLeft += e.deltaY
    }
  }, [])

  // Only show tab bar if there's more than one tab
  if (tabs.length <= 1) {
    return null
  }

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '6px 8px',
        borderBottom: `1px solid ${theme.border}`,
        background: theme.surfaceBg,
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        scrollBehavior: 'smooth'
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              paddingRight: 6,
              background: isActive ? theme.buttonBgHover : 'transparent',
              borderRadius: 6,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              minWidth: 0,
              maxWidth: 180,
              flexShrink: 0
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = theme.surfaceBgHover
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'transparent'
              }
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: isActive ? 500 : 400,
                color: isActive ? theme.text : theme.textSecondary,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                userSelect: 'none'
              }}
            >
              {tab.title || 'Untitled'}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onCloseTab(tab.id)
              }}
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                background: 'transparent',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                padding: 0,
                flexShrink: 0,
                opacity: 0.6,
                transition: 'opacity 0.15s ease, background 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '1'
                e.currentTarget.style.background = theme.buttonBg
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '0.6'
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <X size={12} color={theme.iconColor} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
