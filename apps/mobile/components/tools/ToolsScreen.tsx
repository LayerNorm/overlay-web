import React, { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import type { IntegrationSummary, McpServerSummary, SkillSummary } from '@overlay/app-core'
import { useTheme } from '../../hooks/useTheme'
import { useDrawer } from '../../contexts/DrawerContext'
import { useAppSession } from '../../contexts/AppSessionContext'
import { borderRadius, fontSize, spacing, type Theme } from '../../constants/theme'
import { BottomSheet, EmptyState, MainScreenHeader, SearchField, SegmentedControl, TopBarIconButton } from '../ui/AppChrome'
import { DrawerSidebar } from '../chat/DrawerSidebar'
import { ScreenWithDrawer } from '../ui/ScreenWithDrawer'
import { FeatureGate } from '../ui/FeatureGate'
import {
  connectIntegration,
  createMcpServer,
  createSkill,
  deleteMcpServer,
  deleteSkill,
  disconnectIntegration,
  listIntegrationItems,
  listMcpServers,
  listSkills,
  searchIntegrations,
  testMcpServer,
  updateMcpServer,
  updateSkill,
} from '../../services/integrationsService'

type ToolTab = 'integrations' | 'skills' | 'mcps'

export function ToolsScreen(): React.ReactElement {
  const { theme, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const { openDrawer } = useDrawer()
  const { isFeatureEnabled } = useAppSession()
  const [tab, setTab] = useState<ToolTab>('integrations')
  const [integrations, setIntegrations] = useState<IntegrationSummary[]>([])
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [mcps, setMcps] = useState<McpServerSummary[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [skillEditorOpen, setSkillEditorOpen] = useState(false)
  const [mcpEditorOpen, setMcpEditorOpen] = useState(false)
  const [selectedSkill, setSelectedSkill] = useState<SkillSummary | null>(null)
  const [selectedMcp, setSelectedMcp] = useState<McpServerSummary | null>(null)
  const [skillName, setSkillName] = useState('')
  const [skillDescription, setSkillDescription] = useState('')
  const [skillInstructions, setSkillInstructions] = useState('')
  const [mcpName, setMcpName] = useState('')
  const [mcpUrl, setMcpUrl] = useState('')
  const [mcpTransport, setMcpTransport] = useState<'sse' | 'streamable-http'>('streamable-http')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [integrationResult, skillRows, mcpRows] = await Promise.all([
        listIntegrationItems(),
        listSkills(),
        listMcpServers(),
      ])
      setIntegrations(
        integrationResult.items ??
          integrationResult.connected.map(
            (slug): IntegrationSummary => ({
              slug,
              name: slug,
              description: '',
              logoUrl: null,
              provider: 'composio',
              providerKey: slug,
              capabilities: {
                provider: 'composio',
                hosted: true,
                selfHosted: false,
                oauthOwnership: 'provider-managed',
                connectionSetup: 'provider-console',
                connectionLifecycle: 'provider-managed',
                supportsApprovals: false,
                supportsDisconnect: false,
                supportedSchemas: [],
              },
              isConnected: true,
            }),
          ),
      )
      setSkills(skillRows)
      setMcps(mcpRows)
    } catch (error) {
      Alert.alert('Extensions unavailable', error instanceof Error ? error.message : 'Could not load extensions')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  const filteredIntegrations = useMemo(() => integrations.filter((item) => `${item.name} ${item.slug}`.toLowerCase().includes(query.toLowerCase())), [integrations, query])
  const filteredSkills = useMemo(() => skills.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase())), [skills, query])
  const filteredMcps = useMemo(() => mcps.filter((item) => `${item.name} ${item.url}`.toLowerCase().includes(query.toLowerCase())), [mcps, query])

  async function runIntegrationSearch(): Promise<void> {
    try {
      const result = await searchIntegrations(query)
      setIntegrations(result.items)
    } catch (error) {
      Alert.alert('Search failed', error instanceof Error ? error.message : 'Try again.')
    }
  }

  async function toggleIntegration(item: IntegrationSummary): Promise<void> {
    try {
      if (item.isConnected) {
        await disconnectIntegration(item.slug)
      } else {
        const result = await connectIntegration(item.slug)
        if (result.redirectUrl) await Linking.openURL(result.redirectUrl)
      }
      await load()
    } catch (error) {
      Alert.alert('Integration update failed', error instanceof Error ? error.message : 'Try again.')
    }
  }

  function openSkillEditor(skill: SkillSummary | null): void {
    setSelectedSkill(skill)
    setSkillName(skill?.name || '')
    setSkillDescription(skill?.description || '')
    setSkillInstructions(skill?.instructions || '')
    setSkillEditorOpen(true)
  }

  async function saveSkill(): Promise<void> {
    if (!skillName.trim() || !skillDescription.trim() || !skillInstructions.trim()) {
      Alert.alert('Missing fields', 'Name, description, and instructions are required.')
      return
    }
    try {
      if (selectedSkill) {
        await updateSkill(selectedSkill._id, { name: skillName, description: skillDescription, instructions: skillInstructions })
      } else {
        await createSkill({ name: skillName, description: skillDescription, instructions: skillInstructions })
      }
      setSkillEditorOpen(false)
      await load()
    } catch (error) {
      Alert.alert('Could not save skill', error instanceof Error ? error.message : 'Try again.')
    }
  }

  function openMcpEditor(mcp: McpServerSummary | null): void {
    setSelectedMcp(mcp)
    setMcpName(mcp?.name || '')
    setMcpUrl(mcp?.url || '')
    setMcpTransport(mcp?.transport || 'streamable-http')
    setMcpEditorOpen(true)
  }

  async function saveMcp(): Promise<void> {
    if (!mcpName.trim() || !mcpUrl.trim()) {
      Alert.alert('Missing fields', 'Name and URL are required.')
      return
    }
    try {
      if (selectedMcp) {
        await updateMcpServer(selectedMcp._id, { name: mcpName, url: mcpUrl, transport: mcpTransport })
      } else {
        await createMcpServer({ name: mcpName, url: mcpUrl, transport: mcpTransport, enabled: true, authType: 'none' })
      }
      setMcpEditorOpen(false)
      await load()
    } catch (error) {
      Alert.alert('Could not save MCP server', error instanceof Error ? error.message : 'Try again.')
    }
  }

  const content = (() => {
    if (loading) return <ActivityIndicator color={theme.textSecondary} />
    if (tab === 'integrations') {
      return filteredIntegrations.length ? filteredIntegrations.map((item) => (
        <Row key={item.slug} theme={theme} icon="link" title={item.name} detail={item.isConnected ? 'Connected' : item.description || item.slug} action={<TouchableOpacity onPress={() => { void toggleIntegration(item) }}><Text style={[styles.actionText, { color: theme.text }]}>{item.isConnected ? 'Disconnect' : 'Connect'}</Text></TouchableOpacity>} />
      )) : <EmptyState theme={theme} icon="link" title="No integrations" description="Search for apps to connect." />
    }
    if (tab === 'skills') {
      return filteredSkills.length ? filteredSkills.map((skill) => (
        <Row key={skill._id} theme={theme} icon="terminal" title={skill.name} detail={skill.description} onPress={() => openSkillEditor(skill)} action={<Switch value={skill.enabled !== false} onValueChange={(enabled) => { void updateSkill(skill._id, { enabled }).then(load) }} />} />
      )) : <EmptyState theme={theme} icon="terminal" title="No skills" description="Create reusable instructions for Overlay." />
    }
    return filteredMcps.length ? filteredMcps.map((mcp) => (
      <Row key={mcp._id} theme={theme} icon="server" title={mcp.name} detail={mcp.url} onPress={() => openMcpEditor(mcp)} action={<Switch value={mcp.enabled !== false} onValueChange={(enabled) => { void updateMcpServer(mcp._id, { enabled }).then(load) }} />} />
    )) : <EmptyState theme={theme} icon="server" title="No MCP servers" description="Add MCP tools for the assistant to use." />
  })()

  if (!isFeatureEnabled('extensions')) {
    return <FeatureGate title="Extensions are turned off" />
  }

  return (
    <ScreenWithDrawer drawer={<DrawerSidebar variant="slide" theme={theme} chats={[]} activeChatId={null} onSelectChat={() => {}} onCreateChat={() => {}} />}>
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['bottom']}>
        <MainScreenHeader
          theme={theme}
          isDark={isDark}
          topInset={insets.top}
          blurHeight={insets.top + 56}
          leftSlot={<TopBarIconButton theme={theme} icon="menu" onPress={openDrawer} />}
          centerSlot={<Text style={[styles.headerTitle, { color: theme.text }]}>Extensions</Text>}
          rightSlot={<TopBarIconButton theme={theme} icon="plus" onPress={() => tab === 'skills' ? openSkillEditor(null) : tab === 'mcps' ? openMcpEditor(null) : void runIntegrationSearch()} />}
        />
        <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 72 }]}>
          <SegmentedControl theme={theme} value={tab} onChange={setTab} options={[{ label: 'Apps', value: 'integrations' }, { label: 'Skills', value: 'skills' }, { label: 'MCPs', value: 'mcps' }]} />
          <SearchField theme={theme} value={query} onChangeText={setQuery} placeholder={tab === 'integrations' ? 'Search apps' : 'Search extensions'} />
          <View style={styles.rows}>{content}</View>
        </ScrollView>
        <BottomSheet theme={theme} visible={skillEditorOpen} onClose={() => setSkillEditorOpen(false)} title={selectedSkill ? 'Edit Skill' : 'New Skill'}>
          <View style={styles.form}>
            <TextInput value={skillName} onChangeText={setSkillName} placeholder="Name" placeholderTextColor={theme.textDisabled} style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]} />
            <TextInput value={skillDescription} onChangeText={setSkillDescription} placeholder="Description" placeholderTextColor={theme.textDisabled} style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]} />
            <TextInput value={skillInstructions} onChangeText={setSkillInstructions} placeholder="Instructions" placeholderTextColor={theme.textDisabled} multiline style={[styles.textArea, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]} />
            <View style={styles.formActions}>
              {selectedSkill ? <TouchableOpacity onPress={() => { void deleteSkill(selectedSkill._id).then(() => { setSkillEditorOpen(false); return load() }) }}><Text style={styles.deleteText}>Delete</Text></TouchableOpacity> : null}
              <TouchableOpacity onPress={() => { void saveSkill() }} style={[styles.primaryButton, { backgroundColor: theme.foreground }]}><Text style={[styles.primaryButtonText, { color: theme.background }]}>Save</Text></TouchableOpacity>
            </View>
          </View>
        </BottomSheet>
        <BottomSheet theme={theme} visible={mcpEditorOpen} onClose={() => setMcpEditorOpen(false)} title={selectedMcp ? 'Edit MCP' : 'New MCP'}>
          <View style={styles.form}>
            <TextInput value={mcpName} onChangeText={setMcpName} placeholder="Name" placeholderTextColor={theme.textDisabled} style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]} />
            <TextInput value={mcpUrl} onChangeText={setMcpUrl} placeholder="https://..." placeholderTextColor={theme.textDisabled} autoCapitalize="none" style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]} />
            <SegmentedControl theme={theme} value={mcpTransport} onChange={setMcpTransport} options={[{ label: 'HTTP', value: 'streamable-http' }, { label: 'SSE', value: 'sse' }]} />
            <TouchableOpacity onPress={() => { void testMcpServer({ url: mcpUrl, transport: mcpTransport }).then((result) => Alert.alert(result.ok ? 'Connection works' : 'Connection failed', result.ok ? `${result.toolCount ?? 0} tools found.` : result.error || 'Could not connect.')) }}><Text style={[styles.actionText, { color: theme.text }]}>Test connection</Text></TouchableOpacity>
            <View style={styles.formActions}>
              {selectedMcp ? <TouchableOpacity onPress={() => { void deleteMcpServer(selectedMcp._id).then(() => { setMcpEditorOpen(false); return load() }) }}><Text style={styles.deleteText}>Delete</Text></TouchableOpacity> : null}
              <TouchableOpacity onPress={() => { void saveMcp() }} style={[styles.primaryButton, { backgroundColor: theme.foreground }]}><Text style={[styles.primaryButtonText, { color: theme.background }]}>Save</Text></TouchableOpacity>
            </View>
          </View>
        </BottomSheet>
      </SafeAreaView>
    </ScreenWithDrawer>
  )
}

function Row({ theme, icon, title, detail, action, onPress }: { theme: Theme; icon: keyof typeof Feather.glyphMap; title: string; detail?: string; action?: React.ReactNode; onPress?: () => void }) {
  return (
    <TouchableOpacity activeOpacity={0.82} onPress={onPress} disabled={!onPress} style={[styles.row, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
      <Feather name={icon} size={16} color={theme.textSecondary} />
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>{title}</Text>
        {detail ? <Text style={[styles.rowDetail, { color: theme.textSecondary }]} numberOfLines={2}>{detail}</Text> : null}
      </View>
      {action}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerTitle: { fontSize: fontSize.md, fontWeight: '700', textAlign: 'center' },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  rows: { gap: spacing.sm },
  row: { minHeight: 64, borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.xl, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowCopy: { flex: 1, gap: 3 },
  rowTitle: { fontSize: fontSize.md, fontWeight: '700' },
  rowDetail: { fontSize: fontSize.sm, lineHeight: 18 },
  actionText: { fontSize: fontSize.sm, fontWeight: '700' },
  form: { gap: spacing.md },
  input: { minHeight: 46, borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.lg, paddingHorizontal: spacing.md, fontSize: fontSize.md },
  textArea: { minHeight: 140, borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.lg, padding: spacing.md, fontSize: fontSize.md, textAlignVertical: 'top' },
  formActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  primaryButton: { minHeight: 44, minWidth: 120, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  primaryButtonText: { fontSize: fontSize.md, fontWeight: '700' },
  deleteText: { color: '#EF4444', fontSize: fontSize.md, fontWeight: '700' },
})
