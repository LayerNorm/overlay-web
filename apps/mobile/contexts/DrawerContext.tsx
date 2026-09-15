import React, { createContext, useContext, useState, useCallback } from 'react'
import { Keyboard, useWindowDimensions } from 'react-native'

interface DrawerContextValue {
  drawerVisible: boolean
  openDrawer: () => void
  closeDrawer: () => void
  /**
   * Wide-layout mode (iPad / large tablet): the sidebar renders permanently
   * alongside the content instead of as an overlay drawer. Menu buttons and
   * programmatic drawer opens are suppressed in this mode.
   */
  isSidebarPermanent: boolean
  /**
   * Monotonically-increasing nonce that active screens can observe to know
   * the user pressed the search button in the sidebar. Screens should focus
   * their own search input and scroll it into view when the nonce changes.
   */
  searchNonce: number
  requestSearch: () => void
}

const DrawerContext = createContext<DrawerContextValue>({
  drawerVisible: false,
  openDrawer: () => {},
  closeDrawer: () => {},
  isSidebarPermanent: false,
  searchNonce: 0,
  requestSearch: () => {},
})

/**
 * Permanent-sidebar breakpoint: short edge >= 600pt keeps phones in
 * landscape out, while every full-size iPad orientation qualifies. Split
 * View slices narrower than ~600pt gracefully fall back to the modal drawer.
 */
export function useIsSidebarPermanent(): boolean {
  const { width, height } = useWindowDimensions()
  return Math.min(width, height) >= 600 && width >= 700
}

export function DrawerProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [drawerVisible, setDrawerVisible] = useState(false)
  const [searchNonce, setSearchNonce] = useState(0)
  const isSidebarPermanent = useIsSidebarPermanent()

  const openDrawer = useCallback(() => {
    if (isSidebarPermanent) return
    Keyboard.dismiss()
    setDrawerVisible(true)
  }, [isSidebarPermanent])

  const closeDrawer = useCallback(() => {
    setDrawerVisible(false)
  }, [])

  const requestSearch = useCallback(() => {
    setSearchNonce((n) => n + 1)
  }, [])

  return (
    <DrawerContext.Provider
      value={{
        drawerVisible,
        openDrawer,
        closeDrawer,
        isSidebarPermanent,
        searchNonce,
        requestSearch,
      }}
    >
      {children}
    </DrawerContext.Provider>
  )
}

export function useDrawer(): DrawerContextValue {
  return useContext(DrawerContext)
}
