import React from 'react'
import { useDockableDrag } from './DockablePanelContext'

interface OptionDragOverlayProps {
  isOptionHeld: boolean
}

export function OptionDragOverlay({ isOptionHeld }: OptionDragOverlayProps): React.ReactElement {
  const { startDrag, isDragging } = useDockableDrag()

  return (
    <div
      onMouseDown={(e) => {
        if (isOptionHeld) {
          startDrag(e)
        }
      }}
      style={
        {
          position: 'absolute',
          inset: 0,
          zIndex: isOptionHeld ? 1000 : -1,
          cursor: isOptionHeld ? (isDragging ? 'grabbing' : 'grab') : 'default',
          background: isOptionHeld ? 'rgba(0, 0, 0, 0.02)' : 'transparent',
          pointerEvents: isOptionHeld ? 'auto' : 'none',
          opacity: isOptionHeld ? 1 : 0,
          userSelect: 'none',
          WebkitUserSelect: 'none'
        } as React.CSSProperties
      }
    />
  )
}
