import React from 'react'
import { Pressable, View } from 'react-native'
import { ChevronRight, Network, PanelLeft, Search } from 'lucide-react-native'
import type { Theme } from '../../constants/theme'
import { IconButton, T } from '../shell/primitives'

export function WorkHeader({
  theme,
  scope,
  title,
  onMenu,
  onScope,
  onSearch,
  onBack,
  onOrganization,
}: {
  theme: Theme
  scope: 'personal' | 'workspace'
  title?: string
  onMenu: () => void
  onScope: () => void
  onSearch: () => void
  onBack?: () => void
  onOrganization?: () => void
}) {
  return (
    <View
      style={{
        height: 52,
        paddingHorizontal: 12,
        flexDirection: 'row',
        gap: 8,
        alignItems: 'center',
      }}
    >
      <IconButton label="Open sidebar" icon={PanelLeft} theme={theme} onPress={onMenu} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Change Work scope"
        onPress={onScope}
      >
        <T style={{ color: theme.muted, fontSize: 12 }}>
          {scope === 'personal' ? 'Personal' : 'Workspace'}
        </T>
      </Pressable>
      <ChevronRight size={12} color={theme.muted} />
      <Pressable
        accessibilityRole={onBack ? 'button' : undefined}
        disabled={!onBack}
        onPress={onBack}
      >
        <T style={{ color: theme.foreground, fontSize: 12 }}>Work</T>
      </Pressable>
      {title ? (
        <>
          <ChevronRight size={12} color={theme.muted} />
          <T numberOfLines={1} style={{ flex: 1, color: theme.muted, fontSize: 12 }}>
            {title}
          </T>
        </>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      {onOrganization ? (
        <IconButton label="Organization" icon={Network} theme={theme} onPress={onOrganization} />
      ) : null}
      <IconButton label="Search" icon={Search} theme={theme} onPress={onSearch} />
    </View>
  )
}
