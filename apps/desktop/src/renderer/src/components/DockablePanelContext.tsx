import React, { createContext, useContext } from 'react'

type DockedEdge = 'left' | 'right' | 'top' | 'bottom' | null

export interface DockablePanelContextValue {
  startDrag: (e: React.MouseEvent) => void
  isDragging: boolean
  dockedEdge: DockedEdge
}

export const DockablePanelContext = createContext<DockablePanelContextValue>({
  startDrag: () => {},
  isDragging: false,
  dockedEdge: null
})

export function useDockableDrag(): DockablePanelContextValue {
  return useContext(DockablePanelContext)
}
