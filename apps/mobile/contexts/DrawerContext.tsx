import React, { createContext, useContext, useState, useCallback } from 'react'
import { Keyboard } from 'react-native'

interface DrawerContextValue {
  drawerVisible: boolean
  openDrawer: () => void
  closeDrawer: () => void
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
  searchNonce: 0,
  requestSearch: () => {},
})

export function DrawerProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [drawerVisible, setDrawerVisible] = useState(false)
  const [searchNonce, setSearchNonce] = useState(0)

  const openDrawer = useCallback(() => {
    Keyboard.dismiss()
    setDrawerVisible(true)
  }, [])

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
