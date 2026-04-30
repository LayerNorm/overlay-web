import React, { useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '../../hooks/useTheme'
import { useDrawer } from '../../contexts/DrawerContext'
import { DrawerSidebar } from '../chat/DrawerSidebar'
import { ScreenWithDrawer } from '../ui/ScreenWithDrawer'
import { TopBarIconButton } from '../ui/AppChrome'
import { SegmentedControl } from '../ui/AppChrome'
import { MemoriesList } from './MemoriesList'
import { FilesTree } from './FilesTree'
import { OutputsGallery } from './OutputsGallery'

type KnowledgeTab = 'memories' | 'files' | 'outputs'

const TABS: ReadonlyArray<{ label: string; value: KnowledgeTab }> = [
  { label: 'Memories', value: 'memories' },
  { label: 'Files', value: 'files' },
  { label: 'Outputs', value: 'outputs' },
]

export function KnowledgeScreen(): React.ReactElement {
  const { theme } = useTheme()
  const { openDrawer } = useDrawer()
  const [activeTab, setActiveTab] = useState<KnowledgeTab>('memories')

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
        <View style={styles.screenPadding}>
          <View style={styles.floatingLeft}>
            <TopBarIconButton theme={theme} icon="menu" onPress={openDrawer} />
          </View>

          <View style={styles.tabBar}>
            <SegmentedControl theme={theme} value={activeTab} options={TABS} onChange={setActiveTab} />
          </View>

          <View style={styles.tabContent}>
            {activeTab === 'memories' && <MemoriesList />}
            {activeTab === 'files' && <FilesTree />}
            {activeTab === 'outputs' && <OutputsGallery />}
          </View>
        </View>
      </SafeAreaView>
    </ScreenWithDrawer>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  screenPadding: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  floatingLeft: {
    position: 'absolute',
    top: 8,
    left: 4,
    zIndex: 100,
  },
  tabBar: {
    paddingTop: 60,
    paddingBottom: 8,
    alignItems: 'flex-start',
  },
  tabContent: {
    flex: 1,
  },
})
