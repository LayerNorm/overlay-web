import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface SlashMenuItem {
  title: string
  description: string
  icon: React.ReactNode
  command: () => void
  category: 'nodes' | 'marks' | 'table'
}

interface SlashMenuProps {
  showSlashMenu: boolean
  slashMenuPosition: { top: number; left: number }
  slashMenuFilter: string
  selectedSlashIndex: number
  setSelectedSlashIndex: (index: number) => void
  filteredSlashItems: SlashMenuItem[]
  executeSlashCommand: (item: SlashMenuItem) => void
  onClose: () => void
}

const SECTION_ORDER: Array<{ category: SlashMenuItem['category']; label: string }> = [
  { category: 'nodes', label: 'Blocks' },
  { category: 'table', label: 'Table' },
  { category: 'marks', label: 'Formatting' },
]

export function SlashMenu({
  showSlashMenu,
  slashMenuPosition,
  slashMenuFilter,
  selectedSlashIndex,
  setSelectedSlashIndex,
  filteredSlashItems,
  executeSlashCommand,
  onClose,
}: SlashMenuProps): React.ReactElement<any> | null {
  const slashMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showSlashMenu) return
    const handleClickOutside = (event: MouseEvent): void => {
      if (slashMenuRef.current && !slashMenuRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showSlashMenu, onClose])

  if (!showSlashMenu) return null

  const menu = (
    <div
      ref={slashMenuRef}
      style={{
        position: 'fixed',
        top: Math.max(8, Math.min(slashMenuPosition.top, window.innerHeight - 340)),
        left: Math.max(8, Math.min(slashMenuPosition.left, window.innerWidth - 296)),
        width: 280,
        maxHeight: 320,
        background: 'var(--surface-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        boxShadow: '0 16px 40px rgba(0,0,0,0.12)',
        overflow: 'hidden',
        zIndex: 100000,
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          fontSize: 11,
          color: 'var(--muted)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {slashMenuFilter ? `Searching "${slashMenuFilter}"` : 'Commands'}
      </div>
      <div style={{ maxHeight: 272, overflowY: 'auto', padding: '4px' }}>
        {filteredSlashItems.length === 0 ? (
          <div
            style={{
              padding: '16px',
              textAlign: 'center',
              color: 'var(--muted)',
              fontSize: 13,
            }}
          >
            No matching commands
          </div>
        ) : (
          SECTION_ORDER.map(({ category, label }) => {
            const sectionItems = filteredSlashItems.filter((item) => item.category === category)
            if (sectionItems.length === 0) return null

            return (
              <div key={category}>
                <div
                  style={{
                    padding: '6px 8px',
                    fontSize: 10,
                    color: 'var(--muted)',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    marginTop: category === 'nodes' ? 0 : 4,
                  }}
                >
                  {label}
                </div>
                {sectionItems.map((item) => {
                  const globalIndex = filteredSlashItems.indexOf(item)
                  return (
                    <button
                      key={item.title}
                      onClick={() => executeSlashCommand(item)}
                      onMouseEnter={() => setSelectedSlashIndex(globalIndex)}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        background: selectedSlashIndex === globalIndex ? 'var(--surface-muted)' : 'transparent',
                        border: 'none',
                        borderRadius: 8,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background 0.08s ease',
                        fontFamily: 'system-ui, -apple-system, sans-serif',
                      }}
                    >
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          background: 'var(--surface-muted)',
                          border: '1px solid var(--border)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--foreground)',
                          flexShrink: 0,
                        }}
                      >
                        {item.icon}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: 'var(--foreground)', fontWeight: 500 }}>
                          {item.title}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{item.description}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          })
        )}
      </div>
    </div>
  )

  return createPortal(menu, document.body)
}
