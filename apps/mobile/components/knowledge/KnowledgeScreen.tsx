import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Feather } from '@expo/vector-icons'
import { useTheme } from '../../hooks/useTheme'
import { useDrawer } from '../../contexts/DrawerContext'
import { DrawerSidebar } from '../chat/DrawerSidebar'
import { ScreenWithDrawer } from '../ui/ScreenWithDrawer'
import { BottomSheet, MainScreenHeader, TopBarIconButton } from '../ui/AppChrome'
import { MemoriesList } from './MemoriesList'
import { FilesTree } from './FilesTree'
import { OutputsGallery } from './OutputsGallery'

type KnowledgeTab = 'memories' | 'files' | 'outputs'
type KnowledgeHeaderAction =
  | 'new'
  | 'import'
  | 'selectMemories'
  | 'selectFiles'
  | 'uploadFile'
  | 'uploadFolder'
  | 'selectOutputs'
  | 'outputAll'
  | 'outputImage'
  | 'outputVideo'
  | 'outputFiles'

const TITLES: Record<KnowledgeTab, string> = {
  memories: 'Memories',
  files: 'Files',
  outputs: 'Outputs',
}

export function KnowledgeScreen(): React.ReactElement {
  const { theme, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const { openDrawer } = useDrawer()
  const { tab } = useLocalSearchParams<{ tab?: string }>()
  const [activeTab, setActiveTab] = useState<KnowledgeTab>('memories')
  const [menuOpen, setMenuOpen] = useState(false)
  const [actionRequest, setActionRequest] = useState<{ type: KnowledgeHeaderAction; nonce: number } | null>(null)

  useEffect(() => {
    if (tab === 'memories' || tab === 'files' || tab === 'outputs') {
      setActiveTab(tab)
      void AsyncStorage.setItem('overlay:last-knowledge-view', tab).catch(() => {})
      return
    }

    void AsyncStorage.getItem('overlay:last-knowledge-view')
      .then((lastView) => {
        if (lastView === 'memories' || lastView === 'files' || lastView === 'outputs') {
          setActiveTab(lastView)
        }
      })
      .catch(() => {})
  }, [tab])

  function requestAction(type: KnowledgeHeaderAction): void {
    setMenuOpen(false)
    setActionRequest({ type, nonce: Date.now() })
  }

  const menuItems: Array<{
    key: KnowledgeHeaderAction
    label: string
    icon: keyof typeof Feather.glyphMap
  }> =
    activeTab === 'memories'
      ? [
          { key: 'new', label: 'New', icon: 'plus' },
          { key: 'import', label: 'Import', icon: 'download' },
          { key: 'selectMemories', label: 'Select', icon: 'check-square' },
        ]
      : activeTab === 'files'
        ? [
            { key: 'new', label: 'New', icon: 'file-plus' },
            { key: 'uploadFile', label: 'Upload File', icon: 'upload' },
            { key: 'uploadFolder', label: 'Upload Folder', icon: 'folder-plus' },
            { key: 'selectFiles', label: 'Select for Files', icon: 'check-square' },
          ]
        : [
            { key: 'outputAll', label: 'All', icon: 'grid' },
            { key: 'outputImage', label: 'Image', icon: 'image' },
            { key: 'outputVideo', label: 'Video', icon: 'film' },
            { key: 'outputFiles', label: 'Files', icon: 'file' },
            { key: 'selectOutputs', label: 'Select for Outputs', icon: 'check-square' },
          ]

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
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <MainScreenHeader
          theme={theme}
          isDark={isDark}
          topInset={insets.top}
          blurHeight={insets.top + 56}
          leftSlot={<TopBarIconButton theme={theme} icon="menu" onPress={openDrawer} />}
          centerSlot={
            <Text style={[styles.headerTitle, { color: theme.text }]}>{TITLES[activeTab]}</Text>
          }
          rightSlot={<TopBarIconButton theme={theme} icon="more-horizontal" onPress={() => setMenuOpen(true)} />}
        />
        <View style={[styles.screenPadding, { paddingTop: insets.top + 58 }]}>
          <View style={styles.tabContent}>
            {activeTab === 'memories' && <MemoriesList headerAction={actionRequest} hideInlineToolbar />}
            {activeTab === 'files' && <FilesTree headerAction={actionRequest} hideInlineToolbar />}
            {activeTab === 'outputs' && <OutputsGallery headerAction={actionRequest} hideInlineToolbar />}
          </View>
        </View>
        <BottomSheet theme={theme} visible={menuOpen} onClose={() => setMenuOpen(false)} title={TITLES[activeTab]}>
          <View style={styles.menuList}>
            {menuItems.map((item) => (
              <TouchableOpacity key={item.key} onPress={() => requestAction(item.key)} style={styles.menuItem}>
                <Feather name={item.icon} size={18} color={theme.textSecondary} />
                <Text style={[styles.menuItemText, { color: theme.text }]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </BottomSheet>
      </View>
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
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  tabContent: {
    flex: 1,
  },
  menuList: {
    gap: 4,
  },
  menuItem: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 4,
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: '600',
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
  },
})
