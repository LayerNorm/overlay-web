import React from 'react'
import { Stack } from 'expo-router'
import { useNativeHeaderOptions, useTabRootOptions } from '../../../components/navigation/nativeHeader'

export const unstable_settings = { initialRouteName: 'index' }

export default function FilesLayout(): React.ReactElement {
  return (
    <Stack screenOptions={useNativeHeaderOptions()}>
      <Stack.Screen name="index" options={useTabRootOptions('Files')} />
    </Stack>
  )
}
