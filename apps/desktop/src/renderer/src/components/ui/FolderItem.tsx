import React, { useState, useRef, useCallback } from 'react'
import { ChevronRight, ChevronDown, Trash2, Edit2 } from 'lucide-react'
import type { PanelTheme } from '../../hooks/usePanelTheme'

export interface FolderItemProps {
  id: string
  name: string
  isExpanded: boolean
  depth: number
  isSelected?: boolean
  isDragOver?: boolean
  theme: PanelTheme
  onToggle: (id: string) => void
  onSelect: (id: string) => void
  onRename: (id: string, newName: string) => void
  onDelete: (id: string) => void
  onDragOver?: (e: React.DragEvent, folderId: string) => void
  onDrop?: (e: React.DragEvent, folderId: string) => void
  onDragLeave?: (e: React.DragEvent) => void
  children?: React.ReactNode
}

export function FolderItem({
  id,
  name,
  isExpanded,
  depth,
  isSelected,
  isDragOver,
  theme,
  onToggle,
  onSelect,
  onRename,
  onDelete,
  onDragOver,
  onDrop,
  onDragLeave,
  children
}: FolderItemProps): React.ReactElement {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(name)
  const [isHovered, setIsHovered] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleStartEdit = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      setEditValue(name)
      setIsEditing(true)
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 10)
    },
    [name]
  )

  const handleSaveEdit = useCallback(() => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== name) {
      onRename(id, trimmed)
    }
    setIsEditing(false)
  }, [editValue, name, id, onRename])

  const handleCancelEdit = useCallback(() => {
    setEditValue(name)
    setIsEditing(false)
  }, [name])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSaveEdit()
      } else if (e.key === 'Escape') {
        handleCancelEdit()
      }
    },
    [handleSaveEdit, handleCancelEdit]
  )

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onDelete(id)
    },
    [id, onDelete]
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onDragOver?.(e, id)
    },
    [id, onDragOver]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onDrop?.(e, id)
    },
    [id, onDrop]
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      onDragLeave?.(e)
    },
    [onDragLeave]
  )

  return (
    <div>
      <div
        onClick={() => onSelect(id)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragLeave={handleDragLeave}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 8px',
          paddingLeft: 8 + depth * 16,
          borderRadius: 6,
          cursor: 'pointer',
          userSelect: 'none',
          background: isDragOver
            ? theme.sidebarItemActive
            : isSelected
              ? theme.sidebarItemActive
              : isHovered
                ? theme.sidebarItemHover
                : 'transparent',
          transition: 'background 0.1s ease',
          marginBottom: 2
        }}
      >
        {/* Chevron */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggle(id)
          }}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 2,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 3
          }}
        >
          {isExpanded ? (
            <ChevronDown size={12} color={theme.textMuted} />
          ) : (
            <ChevronRight size={12} color={theme.textMuted} />
          )}
        </button>

        {/* Name / Edit input */}
        {isEditing ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSaveEdit}
              onClick={(e) => e.stopPropagation()}
              style={{
                flex: 1,
                background: theme.surfaceBg,
                border: `1px solid ${theme.border}`,
                borderRadius: 4,
                padding: '2px 6px',
                fontSize: 12,
                color: theme.text,
                outline: 'none',
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}
            />
          </div>
        ) : (
          <span
            style={{
              flex: 1,
              fontSize: 13,
              color: theme.text,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {name}
          </span>
        )}

        {/* Actions */}
        {isHovered && !isEditing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <button
              onClick={handleStartEdit}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 3,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 3,
                opacity: 0.6
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '1'
                e.currentTarget.style.background = theme.surfaceBgHover
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '0.6'
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <Edit2 size={11} color={theme.iconColorMuted} />
            </button>
            <button
              onClick={handleDelete}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 3,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 3,
                opacity: 0.6
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '1'
                e.currentTarget.style.background = 'rgba(255, 100, 100, 0.2)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '0.6'
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <Trash2 size={11} color="rgba(255,100,100,0.8)" />
            </button>
          </div>
        )}
      </div>

      {/* Children (nested items) */}
      {isExpanded && children && <div style={{ marginLeft: 0 }}>{children}</div>}
    </div>
  )
}
