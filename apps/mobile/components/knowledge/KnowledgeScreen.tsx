import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Feather } from '@expo/vector-icons'
import { useTheme } from '../../hooks/useTheme'
import { useDrawer } from '../../contexts/DrawerContext'
import { useAppSession } from '../../contexts/AppSessionContext'
import { DrawerSidebar } from '../chat/DrawerSidebar'
import { ScreenWithDrawer } from '../ui/ScreenWithDrawer'
import { FeatureGate } from '../ui/FeatureGate'
import { BottomSheet, MainScreenHeader, TopBarIconButton } from '../ui/AppChrome'
import { MemoriesList } from './MemoriesList'
import { FilesTree } from './FilesTree'
import { OutputsGallery } from './OutputsGallery'
import { KnowledgeBasesList } from './KnowledgeBasesList'

type KnowledgeTab = 'memories' | 'files' | 'outputs' | 'bases'
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
  bases: 'Knowledge bases',
}

export function KnowledgeScreen(): React.ReactElement {
  const { theme, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const { openDrawer } = useDrawer()
  const { isFeatureEnabled, featureFlags } = useAppSession()
  const knowledgeEnabled = isFeatureEnabled('knowledge') && featureFlags.canUseKnowledge
  const { tab } = useLocalSearchParams<{ tab?: string }>()
  const routeTab: KnowledgeTab | null =
    tab === 'memories' || tab === 'files' || tab === 'outputs' || tab === 'bases' ? tab : null
  const [storedTab, setStoredTab] = useState<KnowledgeTab>('memories')
  const activeTab = routeTab ?? storedTab
  const [menuOpen, setMenuOpen] = useState(false)
  const [actionRequest, setActionRequest] = useState<{ type: KnowledgeHeaderAction; nonce: number } | null>(null)
  const actionNonceRef = useRef(0)

  useEffect(() => {
    if (routeTab) {
      void AsyncStorage.setItem('overlay:last-knowledge-view', routeTab).catch(() => {})
      return
    }

    void AsyncStorage.getItem('overlay:last-knowledge-view')
      .then((lastView) => {
        if (
          lastView === 'memories' ||
          lastView === 'files' ||
          lastView === 'outputs' ||
          lastView === 'bases'
        ) {
          setStoredTab(lastView)
        }
      })
      .catch(() => {})
  }, [routeTab])

  function requestAction(type: KnowledgeHeaderAction): void {
    setMenuOpen(false)
    actionNonceRef.current += 1
    setActionRequest({ type, nonce: actionNonceRef.current })
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
            { key: 'selectFiles', label: 'Select', icon: 'check-square' },
          ]
        : activeTab === 'bases'
          ? []
          : [
            { key: 'outputAll', label: 'All', icon: 'grid' },
            { key: 'outputImage', label: 'Image', icon: 'image' },
            { key: 'outputVideo', label: 'Video', icon: 'film' },
            { key: 'outputFiles', label: 'Files', icon: 'file' },
            { key: 'selectOutputs', label: 'Select', icon: 'check-square' },
          ]

  if (!knowledgeEnabled) {
    return <FeatureGate title="Knowledge is turned off" />
  }

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
          rightSlot={
            activeTab === 'bases' ? (
              <View style={styles.headerSpacer} />
            ) : (
              <TopBarIconButton theme={theme} icon="more-horizontal" onPress={() => setMenuOpen(true)} />
            )
          }
        />
        <View style={styles.screenPadding}>
          <View style={styles.tabContent}>
            {activeTab === 'memories' && (
              <MemoriesList headerAction={actionRequest} hideInlineToolbar topInset={insets.top + 58} />
            )}
            {activeTab === 'files' && (
              <FilesTree headerAction={actionRequest} hideInlineToolbar topInset={insets.top + 58} />
            )}
            {activeTab === 'outputs' && (
              <OutputsGallery headerAction={actionRequest} hideInlineToolbar topInset={insets.top + 58} />
            )}
            {activeTab === 'bases' && <KnowledgeBasesList topInset={insets.top + 58} />}
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
  headerSpacer: {
    width: 36,
    height: 36,
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
