import React from 'react'
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native'
import { ArrowLeft, Check, ChevronRight, Settings, X } from 'lucide-react-native'
import type { Theme } from '../../constants/theme'
import { IconButton, T } from './primitives'

export function AccountSheet({
  theme,
  name,
  email,
  workspaces,
  activeId,
  switching,
  error,
  bottomInset = 0,
  onSwitch,
  onClose,
  onSettings,
  onSignOut,
}: {
  theme: Theme
  name: string
  email: string
  workspaces: Array<{ id: string; name: string; description?: string }>
  activeId: string | null
  switching?: boolean
  error?: string | null
  bottomInset?: number
  onSwitch: (id: string) => void
  onClose: () => void
  onSettings: () => void
  onSignOut: () => void
}) {
  const row = { flexDirection: 'row', alignItems: 'center', gap: 10 } as const
  return (
    <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: theme.overlayScrim }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss account sheet"
        onPress={onClose}
        style={{ flex: 1 }}
      />
      <View
        accessibilityViewIsModal
        style={{
          maxHeight: '90%',
          minHeight: 460,
          backgroundColor: theme.surfaceElevated,
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          paddingHorizontal: 22,
          paddingTop: 10,
          paddingBottom: 24 + bottomInset,
        }}
      >
        <View
          style={{
            width: 34,
            height: 4,
            backgroundColor: theme.border,
            borderRadius: 3,
            alignSelf: 'center',
            marginBottom: 18,
          }}
        />
        <View style={[row, { marginBottom: 22 }]}>
          <T style={{ flex: 1, fontSize: 20, letterSpacing: -0.5, color: theme.foreground }}>
            Workspace and account
          </T>
          <IconButton theme={theme} icon={X} label="Close sheet" onPress={onClose} />
        </View>
        <ScrollView>
          <View style={[row, { marginBottom: 28 }]}>
            <View
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                backgroundColor: theme.surfaceSubtle,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <T style={{ color: theme.foreground, fontSize: 9 }}>
                {name
                  .split(' ')
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join('')}
              </T>
            </View>
            <View style={{ flex: 1, gap: 5 }}>
              <T style={{ color: theme.foreground }}>{name}</T>
              <T style={{ color: theme.muted, fontSize: 12 }}>{email}</T>
            </View>
          </View>
          <T style={{ color: theme.muted, fontSize: 12, marginBottom: 12 }}>Workspaces</T>
          {workspaces.map((workspace) => (
            <Pressable
              key={workspace.id}
              disabled={switching}
              accessibilityRole="button"
              accessibilityState={{ selected: activeId === workspace.id, disabled: switching }}
              onPress={() => onSwitch(workspace.id)}
              style={[row, { minHeight: 66, paddingVertical: 12 }]}
            >
              <View style={{ flex: 1, gap: 5 }}>
                <T style={{ color: theme.foreground }}>{workspace.name}</T>
                {workspace.description ? (
                  <T style={{ color: theme.muted, fontSize: 12 }}>{workspace.description}</T>
                ) : null}
              </View>
              {activeId === workspace.id ? (
                <Check color={theme.muted} size={16} />
              ) : (
                <ChevronRight color={theme.muted} size={16} />
              )}
            </Pressable>
          ))}
          {switching ? <ActivityIndicator color={theme.muted} /> : null}
          {error ? (
            <T accessibilityRole="alert" style={{ color: theme.muted }}>
              {error}
            </T>
          ) : null}
          <T style={{ color: theme.muted, fontSize: 12, marginTop: 22, marginBottom: 14 }}>
            Account
          </T>
          {[
            { label: 'Settings', icon: Settings, action: onSettings },
            { label: 'Sign out', icon: ArrowLeft, action: onSignOut },
          ].map((item) => (
            <Pressable
              key={item.label}
              accessibilityRole="button"
              onPress={item.action}
              style={[row, { paddingVertical: 17 }]}
            >
              <item.icon size={16} color={theme.muted} />
              <T style={{ color: theme.muted, flex: 1 }}>{item.label}</T>
              <ChevronRight size={16} color={theme.muted} />
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  )
}
