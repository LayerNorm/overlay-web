import React from 'react'
import { Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../hooks/useTheme'
import { useDrawer } from '../../contexts/DrawerContext'
import { DrawerSidebar } from '../../components/chat/DrawerSidebar'
import { ScreenWithDrawer } from '../../components/ui/ScreenWithDrawer'
import { MainScreenHeader, TopBarIconButton } from '../../components/ui/AppChrome'

export default function WorkRoute(): React.ReactElement {
  const { theme, isDark } = useTheme()
  const { openDrawer } = useDrawer()
  const insets = useSafeAreaInsets()

  return (
    <ScreenWithDrawer drawer={<DrawerSidebar variant="slide" theme={theme} chats={[]} activeChatId={null} onSelectChat={() => {}} onCreateChat={() => {}} />}>
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <MainScreenHeader
          theme={theme}
          isDark={isDark}
          topInset={insets.top}
          centerSlot={<Text style={{ color: theme.text }}>Work</Text>}
          leftSlot={<TopBarIconButton theme={theme} icon="menu" onPress={openDrawer} />}
        />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: theme.textSecondary }}>Work is coming in Phase 2.</Text>
        </View>
      </View>
    </ScreenWithDrawer>
  )
}
