import { ReactElement, useState, useCallback } from 'react'
import { Plus, Eye, EyeOff, Lock, Unlock } from 'lucide-react'
import { BrowserTab, Theme } from '../types'
import { Tab } from './Tab'
import { SettingsTab } from './SettingsTab'
import { TrafficLightButtons } from '../../ui/TrafficLightButtons'
import { useDockableDrag } from '../../DockablePanelContext'
import './TabBar.css'

interface TabBarProps {
  tabs: BrowserTab[]
  activeTabId: string | null
  showSettings: boolean
  isSettingsTabOpen: boolean
  theme: Theme
  onTabSelect: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onNewTab: () => void
  onSettingsSelect: () => void
  onSettingsClose: () => void
  onReorderTabs: (fromIndex: number, toIndex: number) => void
  onPanelClose: () => void
  onPanelMinimize: () => void
  onPanelMaximize: () => void
  isMaximized: boolean
  contentProtection: boolean
  onToggleContentProtection: () => void
  headerLocked: boolean
  onToggleHeaderLock: () => void
  showWindowControls?: boolean
  showUtilityControls?: boolean
}

export function TabBar({
  tabs,
  activeTabId,
  showSettings,
  isSettingsTabOpen,
  theme,
  onTabSelect,
  onTabClose,
  onNewTab,
  onSettingsSelect,
  onSettingsClose,
  onReorderTabs,
  onPanelClose,
  onPanelMinimize,
  onPanelMaximize,
  isMaximized,
  contentProtection,
  onToggleContentProtection,
  headerLocked,
  onToggleHeaderLock,
  showWindowControls = true,
  showUtilityControls = true
}: TabBarProps): ReactElement<any> {
  const { startDrag } = useDockableDrag()
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }, [])

  const handleDragEnd = useCallback(() => {
    setDragIndex(null)
    setDragOverIndex(null)
  }, [])

  const handleDrop = useCallback(
    (toIndex: number) => {
      if (dragIndex !== null && dragIndex !== toIndex) {
        onReorderTabs(dragIndex, toIndex)
      }
      setDragIndex(null)
      setDragOverIndex(null)
    },
    [dragIndex, onReorderTabs]
  )
  return (
    <div
      style={
        {
          display: 'flex',
          alignItems: 'stretch',
          padding: '4px 8px 0 8px',
          background: 'transparent',
          WebkitAppRegion: 'no-drag',
          position: 'relative'
        } as React.CSSProperties
      }
      onMouseDown={startDrag}
    >
      {/* Left anchored section - Traffic Light Buttons */}
      {showWindowControls && (
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, paddingBottom: 4 }}>
          <TrafficLightButtons
            panelType="browser"
            onClose={onPanelClose}
            onMinimize={onPanelMinimize}
            onMaximize={onPanelMaximize}
            isMaximized={isMaximized}
          />
          <div style={{ width: 8 }} />
        </div>
      )}

      {/* Scrollable tabs section */}
      <div
        className="browser-tabs-scroll"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          flex: 1,
          overflowX: 'auto',
          overflowY: 'hidden',
          minWidth: 0
        }}
      >
        {tabs.map((tab, index) => (
          <Tab
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId && !showSettings}
            theme={theme}
            index={index}
            onSelect={() => onTabSelect(tab.id)}
            onClose={() => onTabClose(tab.id)}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            isDragging={dragIndex === index}
            dragIndex={dragIndex}
            dragOverIndex={dragOverIndex}
          />
        ))}
        {isSettingsTabOpen && (
          <SettingsTab
            isActive={showSettings}
            theme={theme}
            onSelect={onSettingsSelect}
            onClose={onSettingsClose}
          />
        )}
        <button
          onClick={onNewTab}
          style={
            {
              width: 28,
              height: 32,
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              WebkitAppRegion: 'no-drag',
              flexShrink: 0
            } as React.CSSProperties
          }
          title="New tab"
        >
          <Plus size={16} color={theme.textSecondary} />
        </button>
      </div>

      {/* Right anchored section - Eye and Lock buttons */}
      {showUtilityControls && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
            gap: 2,
            paddingBottom: 4,
            marginLeft: 8
          }}
        >
        {/* Eye Button */}
        <button
          onClick={onToggleContentProtection}
          title={contentProtection ? 'Show in screenshots' : 'Hide from screenshots'}
          style={
            {
              width: 28,
              height: 28,
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              WebkitAppRegion: 'no-drag'
            } as React.CSSProperties
          }
        >
          {contentProtection ? (
            <EyeOff size={16} color={theme.textSecondary} />
          ) : (
            <Eye size={16} color={theme.textSecondary} />
          )}
        </button>

        {/* Lock Button */}
        <button
          onClick={onToggleHeaderLock}
          title={
            headerLocked
              ? 'Unlock header (hide when unfocused)'
              : 'Lock header (keep visible when unfocused)'
          }
          style={
            {
              width: 28,
              height: 28,
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              WebkitAppRegion: 'no-drag'
            } as React.CSSProperties
          }
        >
          {headerLocked ? (
            <Lock size={16} color={theme.textSecondary} />
          ) : (
            <Unlock size={16} color={theme.textSecondary} />
          )}
        </button>
        </div>
      )}
    </div>
  )
}
