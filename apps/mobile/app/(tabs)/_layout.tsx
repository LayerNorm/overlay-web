import React from 'react'
import { Slot } from 'expo-router'
import { DrawerProvider } from '../../contexts/DrawerContext'

export default function TabLayout(): React.ReactElement {
  return (
    <DrawerProvider>
      <Slot />
    </DrawerProvider>
  )
}
