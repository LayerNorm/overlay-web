import React, { useState, useCallback, useEffect } from 'react'

interface ResizableDividerProps {
  direction: 'horizontal' | 'vertical'
  onResize: (delta: number) => void
  theme: {
    border: string
    isDark: boolean
  }
}

export function ResizableDivider({
  direction,
  onResize,
  theme
}: ResizableDividerProps): React.ReactElement<any> {
  const [isDragging, setIsDragging] = useState(false)
  const [startPos, setStartPos] = useState(0)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsDragging(true)
      setStartPos(direction === 'horizontal' ? e.clientX : e.clientY)
    },
    [direction]
  )

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent): void => {
      const currentPos = direction === 'horizontal' ? e.clientX : e.clientY
      const delta = startPos - currentPos
      onResize(delta)
      setStartPos(currentPos)
    }

    const handleMouseUp = (): void => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, startPos, direction, onResize])

  const isHorizontal = direction === 'horizontal'

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        width: isHorizontal ? 6 : '100%',
        height: isHorizontal ? '100%' : 6,
        cursor: isHorizontal ? 'col-resize' : 'row-resize',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        background: 'transparent',
        position: 'relative',
        zIndex: 10
      }}
    >
      {/* Visual indicator line */}
      <div
        style={{
          width: isHorizontal ? 1 : '100%',
          height: isHorizontal ? '100%' : 1,
          background: theme.border,
          transition: 'background 0.15s ease',
          ...(isDragging && {
            background: theme.isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'
          })
        }}
      />
      {/* Hover/drag indicator */}
      <div
        style={{
          position: 'absolute',
          width: isHorizontal ? 3 : '100%',
          height: isHorizontal ? '100%' : 3,
          background: isDragging
            ? theme.isDark
              ? 'rgba(59, 130, 246, 0.5)'
              : 'rgba(59, 130, 246, 0.4)'
            : 'transparent',
          borderRadius: 2,
          transition: 'background 0.15s ease'
        }}
        onMouseEnter={(e) => {
          if (!isDragging) {
            e.currentTarget.style.background = theme.isDark
              ? 'rgba(255,255,255,0.15)'
              : 'rgba(0,0,0,0.1)'
          }
        }}
        onMouseLeave={(e) => {
          if (!isDragging) {
            e.currentTarget.style.background = 'transparent'
          }
        }}
      />
    </div>
  )
}
