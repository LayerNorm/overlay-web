import React, { useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
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

type FilesTab = 'memories' | 'files' | 'outputs'
type FilesHeaderAction =
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

const TITLES: Record<FilesTab, string> = {
  memories: 'Memories',
  files: 'Files',
  outputs: 'Outputs',
}

export function FilesScreen({ memoriesOnly = false }: { memoriesOnly?: boolean } = {}): React.ReactElement {
  const router = useRouter()
  const { theme, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const { openDrawer } = useDrawer()
  const { capabilities, isFeatureEnabled } = useAppSession()
  const resourceEnabled = memoriesOnly
    ? capabilities.memory && isFeatureEnabled('knowledge')
    : capabilities.files
  const { tab } = useLocalSearchParams<{ tab?: string }>()
  const activeTab: FilesTab = memoriesOnly ? 'memories' : tab === 'outputs' ? 'outputs' : 'files'
  const [menuOpen, setMenuOpen] = useState(false)
  const [actionRequest, setActionRequest] = useState<{ type: FilesHeaderAction; nonce: number } | null>(null)
  const actionNonceRef = useRef(0)

  function requestAction(type: FilesHeaderAction): void {
    setMenuOpen(false)
    actionNonceRef.current += 1
    setActionRequest({ type, nonce: actionNonceRef.current })
  }

  const menuItems: Array<{
    key: FilesHeaderAction
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
        : [
            { key: 'outputAll', label: 'All', icon: 'grid' },
            { key: 'outputImage', label: 'Image', icon: 'image' },
            { key: 'outputVideo', label: 'Video', icon: 'film' },
            { key: 'outputFiles', label: 'Files', icon: 'file' },
            { key: 'selectOutputs', label: 'Select', icon: 'check-square' },
          ]

  if (!resourceEnabled) {
    return <FeatureGate title="This resource is turned off" />
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
            <TopBarIconButton theme={theme} icon="more-horizontal" onPress={() => setMenuOpen(true)} />
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
          </View>
        </View>
        <BottomSheet theme={theme} visible={menuOpen} onClose={() => setMenuOpen(false)} title={TITLES[activeTab]}>
          <View style={styles.menuList}>
            {!memoriesOnly ? (
              <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); router.push('/(tabs)/notes') }}>
                <Text style={{ color: theme.text }}>Notes</Text>
              </TouchableOpacity>
            ) : null}
            {!memoriesOnly ? (
              <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); router.push(activeTab === 'outputs' ? '/(tabs)/files' : '/(tabs)/files?tab=outputs') }}>
                <Text style={{ color: theme.text }}>{activeTab === 'outputs' ? 'Files' : 'Outputs'}</Text>
              </TouchableOpacity>
            ) : null}
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
