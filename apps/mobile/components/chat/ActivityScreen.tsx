import React, { useEffect, useState } from 'react'
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { WorkspaceNotification, WorkspaceNotificationFilter } from '@overlay/workspace-contracts'
import { useTheme } from '../../hooks/useTheme'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useNativeDataReady } from '../../contexts/ConvexAuthProvider'
import { useDrawer } from '../../contexts/DrawerContext'
import { filterNotifications, markNotificationsRead, subscribeNotifications } from '../../services/collaborationService'
import { openNotificationDestination } from '../../lib/notificationRouting'
import { MainScreenHeader, EmptyState, TopBarIconButton } from '../ui/AppChrome'
import { ListRow, Section } from '../ui/primitives'

const FILTERS: WorkspaceNotificationFilter[] = ['all', 'unread', 'mentions', 'threads', 'reactions']

export function ActivityScreen(): React.ReactElement {
  const { theme, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { openDrawer } = useDrawer()
  const ready = useNativeDataReady()
  const { activeWorkspaceId } = useWorkspace()
  const [items, setItems] = useState<WorkspaceNotification[]>([])
  const [filter, setFilter] = useState<WorkspaceNotificationFilter>('all')
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    setItems([])
    setLoaded(false)
    if (!ready || !activeWorkspaceId) return
    return subscribeNotifications(value => { setItems(value); setLoaded(true) })
  }, [ready, activeWorkspaceId])
  const visible = filterNotifications(items, filter)
  return <View style={{ flex: 1, backgroundColor: theme.background }}>
    <MainScreenHeader theme={theme} isDark={isDark} topInset={insets.top} leftSlot={<TopBarIconButton theme={theme} icon="sidebar" onPress={openDrawer} />} centerSlot={<Text style={{ color: theme.text }}>Activity</Text>} />
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: insets.top + 68, paddingBottom: insets.bottom + 24 }}>
      <View style={{ flexDirection: 'row', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {FILTERS.map(value => <TouchableOpacity key={value} accessibilityRole="button" accessibilityState={{ selected: filter === value }} onPress={() => setFilter(value)}>
          <Text style={{ color: filter === value ? theme.text : theme.textSecondary }}>{value[0].toUpperCase() + value.slice(1)}</Text>
        </TouchableOpacity>)}
      </View>
      {visible.length ? <Section theme={theme}>
        {visible.map(item => <ListRow key={item.id} theme={theme} title={item.title} subtitle={item.body} detail={item.readAt ? undefined : 'Unread'} onPress={() => {
          void markNotificationsRead([item.id]).then(() => openNotificationDestination(router, item)).catch(() => Alert.alert('Could not open activity', 'Please try again.'))
        }} />)}
      </Section> : <EmptyState theme={theme} icon="bell" title={loaded ? 'You are all caught up' : 'Loading activity…'} description={loaded ? 'New activity will appear here.' : 'Connecting to your workspace.'} />}
    </ScrollView>
  </View>
}
