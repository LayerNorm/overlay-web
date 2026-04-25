import React, { createContext, useContext, useState } from 'react'

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
  return (
    <DrawerContext.Provider
      value={{
        drawerVisible,
        openDrawer: () => setDrawerVisible(true),
        closeDrawer: () => setDrawerVisible(false),
      }}
    >
      {children}
    </DrawerContext.Provider>
  )
}

export function useDrawer(): DrawerContextValue {
  return useContext(DrawerContext)
}
