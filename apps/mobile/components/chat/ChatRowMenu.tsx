import React from 'react'
import { View, useWindowDimensions } from 'react-native'
import { Button, ContextMenu, Host, RNHostView } from '@expo/ui/swift-ui'
import { useTheme } from '../../hooks/useTheme'

export type RowAction = { label: string; icon: string; destructive?: boolean; onPress: () => void }

/**
 * Touch and hold a full-width list row for the system context menu. With no
 * actions the row renders as is.
 */
export function RowMenu({ actions, children }: { actions: RowAction[]; children: React.ReactNode }) {
  const { theme, isDark } = useTheme()
  const { width } = useWindowDimensions()
  if (!actions.length) return <>{children}</>
  return (
    <Host matchContents={{ vertical: true }} style={{ width }} colorScheme={isDark ? 'dark' : 'light'}>
      <ContextMenu>
        <ContextMenu.Items>
          {actions.map((action) => (
            <Button
              key={action.label}
              label={action.label}
              systemImage={action.icon as never}
              role={action.destructive ? 'destructive' : undefined}
              onPress={action.onPress}
            />
          ))}
        </ContextMenu.Items>
        <ContextMenu.Trigger>
          <RNHostView matchContents>
            {/* Opaque so the lifted preview reads as the row. */}
            <View style={{ width, backgroundColor: theme.background }}>{children}</View>
          </RNHostView>
        </ContextMenu.Trigger>
      </ContextMenu>
    </Host>
  )
}
