import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../hooks/useTheme'
import { useDrawer } from '../../contexts/DrawerContext'
import { EmptyState, MainScreenHeader, TopBarIconButton } from './AppChrome'

/**
 * Disabled-feature fallback for tab screens. Keeps the app chrome (header +
 * drawer access) so a server-side flag flip reads as "feature off", not a
 * broken screen.
 */
export function FeatureGate({
  title,
  description = 'This feature is turned off for your account.',
}: {
  title: string
  description?: string
}): React.ReactElement {
  const { theme, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const { openDrawer } = useDrawer()

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <MainScreenHeader
        theme={theme}
        isDark={isDark}
        topInset={insets.top}
        leftSlot={<TopBarIconButton theme={theme} icon="menu" onPress={openDrawer} />}
        centerSlot={null}
      />
      <View style={[styles.body, { paddingTop: insets.top + 72 }]}>
        <EmptyState theme={theme} icon="slash" title={title} description={description} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 80,
  },
})
