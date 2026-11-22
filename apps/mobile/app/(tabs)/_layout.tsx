import React from 'react'
import { NativeTabs } from 'expo-router/unstable-native-tabs'
import { useTheme } from '../../hooks/useTheme'
import { useAppSession } from '../../contexts/AppSessionContext'

/**
 * The app's primary navigation: a native UITabBarController (Liquid Glass on
 * iOS 26, a sidebar on iPad). Mirrors the web app's Work, Agents, Chats and
 * Files; Automations, Extensions, Activity and Settings live in the account
 * sheet. Search is the system search tab.
 */
export default function TabLayout(): React.ReactElement {
  const { theme } = useTheme()
  const { isFeatureEnabled, capabilities } = useAppSession()
  return (
    <NativeTabs tintColor={theme.foreground} minimizeBehavior="onScrollDown" sidebarAdaptable>
      <NativeTabs.Trigger name="work">
        <NativeTabs.Trigger.Icon sf="checklist" md="checklist" />
        <NativeTabs.Trigger.Label>Work</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="agents" hidden={!isFeatureEnabled('agents')}>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} md="group" />
        <NativeTabs.Trigger.Label>Agents</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="chats" hidden={!capabilities.chat}>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }}
          md="forum"
        />
        <NativeTabs.Trigger.Label>Chats</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="files" hidden={!capabilities.files}>
        <NativeTabs.Trigger.Icon sf={{ default: 'folder', selected: 'folder.fill' }} md="folder" />
        <NativeTabs.Trigger.Label>Files</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search" role="search">
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
