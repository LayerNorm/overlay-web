import React, { createContext, useContext, useState, useCallback } from 'react'
import { Keyboard } from 'react-native'

interface DrawerContextValue {
  drawerVisible: boolean
  openDrawer: () => void
  closeDrawer: () => void
}

const DrawerContext = createContext<DrawerContextValue>({
  drawerVisible: false,
  openDrawer: () => {},
  closeDrawer: () => {},
})

export function DrawerProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [drawerVisible, setDrawerVisible] = useState(false)

  const openDrawer = useCallback(() => {
    Keyboard.dismiss()
    setDrawerVisible(true)
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerVisible(false)
  }, [])

  return (
    <DrawerContext.Provider
      value={{
        drawerVisible,
        openDrawer,
        closeDrawer,
      }}
    >
      {children}
    </DrawerContext.Provider>
  )
}

export function useDrawer(): DrawerContextValue {
  return useContext(DrawerContext)
}
