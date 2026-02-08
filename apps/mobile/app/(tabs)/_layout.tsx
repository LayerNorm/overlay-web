import React from 'react'
import { DynamicColorIOS } from 'react-native'
import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs'

const labelColor = DynamicColorIOS({ dark: 'white', light: 'black' })
const tintColorValue = DynamicColorIOS({ dark: 'white', light: 'black' })

export default function TabLayout(): React.ReactElement {
  return (
    <NativeTabs
      labelStyle={{ color: labelColor }}
      tintColor={tintColorValue}
    >
      <NativeTabs.Trigger name="index">
        <Label>Home</Label>
        <Icon sf={{ default: 'house', selected: 'house.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="chats">
        <Label>Chats</Label>
        <Icon sf={{ default: 'bubble.left', selected: 'bubble.left.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="notes">
        <Label>Notes</Label>
        <Icon sf={{ default: 'doc.text', selected: 'doc.text.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <Label>Settings</Label>
        <Icon sf="gear" />
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
