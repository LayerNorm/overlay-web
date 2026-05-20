import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useTheme } from '../../hooks/useTheme'
import { useDrawer } from '../../contexts/DrawerContext'
import { DrawerSidebar } from '../chat/DrawerSidebar'
import { ScreenWithDrawer } from './ScreenWithDrawer'
import { fontSize, spacing } from '../../constants/theme'

export function PlaceholderScreen({
  title,
  icon,
}: {
  title: string
  icon: React.ComponentProps<typeof Feather>['name']
}): React.ReactElement {
  const { theme } = useTheme()
  const { openDrawer } = useDrawer()

  return (
    <ScreenWithDrawer
      drawer={
        <DrawerSidebar
          variant="slide"
          theme={theme}
          chats={[]}
          activeChatId={null}
          onSelectChat={() => {}}
          onCreateChat={() => {}}
        />
      }
    >
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
        <View style={[styles.topBar, { borderBottomColor: theme.border }]}>
          <TouchableOpacity
            onPress={openDrawer}
            style={[styles.iconButton, { borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}
            activeOpacity={0.7}
          >
            <Feather name="menu" size={16} color={theme.muted} />
          </TouchableOpacity>
          <Text style={[styles.topBarTitle, { color: theme.text, fontFamily: 'LibreBaskerville' }]}>
            {title}
          </Text>
          <View style={styles.iconButton} />
        </View>

        <View style={styles.body}>
          <Feather name={icon} size={40} color={theme.mutedLight} />
          <Text style={[styles.label, { color: theme.mutedLight }]}>Coming soon</Text>
        </View>
      </SafeAreaView>
    </ScreenWithDrawer>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 52,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  label: {
    fontSize: fontSize.md,
    fontWeight: '400',
  },
})
