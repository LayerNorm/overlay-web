import React from 'react'
import { View, useWindowDimensions } from 'react-native'
import { NativeTabs } from 'expo-router/unstable-native-tabs'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button, Host, Image as Symbol, Menu } from '@expo/ui/swift-ui'
import { accessibilityLabel, contentShape, frame, shapes } from '@expo/ui/swift-ui/modifiers'
import { useTheme } from '../../hooks/useTheme'
import { useAppSession } from '../../contexts/AppSessionContext'
import { MODE_OPTIONS, modeIcon, useMode } from '../../contexts/ModeContext'

/** The system tab bar's separate circle on iPhone (iOS 26), measured in points. */
const MODE_BUTTON = { size: 62, right: 21, aboveHomeIndicator: 19 }

/**
 * The app's primary navigation: a native UITabBarController (Liquid Glass on
 * iOS 26, a sidebar on iPad). Mirrors the web app's Work, Agents, Chats and
 * Files; Automations, Extensions, Activity and Settings live in the account
 * sheet; Search is in each tab's header. The separate circle is the Workspace |
 * Personal switch: on iPhone a native menu sits over it, and elsewhere the tab
 * opens a page with the same choice.
 */
export default function TabLayout(): React.ReactElement {
  const { theme, isDark } = useTheme()
  const { isFeatureEnabled, capabilities } = useAppSession()
  const { mode, setMode } = useMode()
  const { bottom } = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const label = MODE_OPTIONS.find((option) => option.value === mode)?.label ?? 'Workspace'
  // iPad shows the tabs as a top bar or sidebar, where there is no circle to cover.
  const compact = width < 700
  return (
    <View style={{ flex: 1 }}>
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
        <NativeTabs.Trigger name="mode" role="search">
          <NativeTabs.Trigger.Icon sf={modeIcon(mode)} md={mode === 'personal' ? 'person' : 'business'} />
          <NativeTabs.Trigger.Label>{label}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
      {compact ? (
        <Host
          style={{
            position: 'absolute',
            right: MODE_BUTTON.right,
            bottom: Math.max(bottom - MODE_BUTTON.aboveHomeIndicator, 8),
            width: MODE_BUTTON.size,
            height: MODE_BUTTON.size,
          }}
          colorScheme={isDark ? 'dark' : 'light'}
        >
          <Menu
            label={
              <Symbol
                systemName={modeIcon(mode)}
                size={24}
                // The tab's own icon shows through; this only takes the tap.
                color="#00000002"
                modifiers={[frame({ width: MODE_BUTTON.size, height: MODE_BUTTON.size }), contentShape(shapes.circle())]}
              />
            }
            modifiers={[accessibilityLabel(`Mode: ${label}`)]}
          >
            {MODE_OPTIONS.map((option) => (
              <Button
                key={option.value}
                label={option.label}
                systemImage={option.value === mode ? 'checkmark' : option.icon}
                onPress={() => setMode(option.value)}
              />
            ))}
          </Menu>
        </Host>
      ) : null}
    </View>
  )
}
