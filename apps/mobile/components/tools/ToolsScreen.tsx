import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { EnrichedMarkdownText } from 'react-native-enriched-markdown'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import type { IntegrationSummary, McpAuthType, McpServerSummary, SkillSummary } from '@overlay/app-core'
import { useTheme } from '../../hooks/useTheme'
import { useDrawer } from '../../contexts/DrawerContext'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useAppSession } from '../../contexts/AppSessionContext'
import { borderRadius, fontSize, spacing, type Theme } from '../../constants/theme'
import { BottomSheet, EmptyState, MainScreenHeader, SearchField, SegmentedControl, StatusPill, TopBarIconButton } from '../ui/AppChrome'
import { DrawerSidebar } from '../chat/DrawerSidebar'
import { ScreenWithDrawer } from '../ui/ScreenWithDrawer'
import { FeatureGate } from '../ui/FeatureGate'
import { McpDetailSheet } from './McpDetailSheet'
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
  type IntegrationScope,
} from '../../services/integrationsService'

type ToolTab = 'integrations' | 'skills' | 'mcps'

/** Any overlay:// link works as the auth-session return — the Composio callback
 *  page never redirects to it, so the session ends when the user taps Done. */
const INTEGRATION_RETURN_URL = 'overlay://extensions'

export function ToolsScreen(): React.ReactElement {
  const { activeWorkspaceId, activeWorkspace } = useWorkspace()
  const { isFeatureEnabled } = useAppSession()
  const [selection, setSelection] = useState<{ workspaceId: string; scope: IntegrationScope }>()
  if (!isFeatureEnabled('extensions')) return <FeatureGate title="Extensions are turned off" />
  if (!activeWorkspaceId) return <FeatureGate title="Choose a workspace to view extensions" />
  const canShare = Boolean(activeWorkspace && activeWorkspace.kind !== 'personal')
  const scope = canShare && selection?.workspaceId === activeWorkspaceId ? selection.scope : 'personal'
  return (
    <ScopedToolsScreen
      key={activeWorkspaceId + ':' + scope}
      workspaceId={activeWorkspaceId}
      scope={scope}
      onScopeChange={canShare ? (next) => setSelection({ workspaceId: activeWorkspaceId, scope: next }) : undefined}
    />
  )
}

function ScopedToolsScreen({ workspaceId, scope, onScopeChange }: {
  workspaceId: string
  scope: IntegrationScope
  onScopeChange?: (scope: IntegrationScope) => void
}): React.ReactElement {
  const { theme, isDark } = useTheme()
  const insets = useSafeAreaInsets()
  const { openDrawer } = useDrawer()
  const [tab, setTab] = useState<ToolTab>('integrations')
  const [integrations, setIntegrations] = useState<IntegrationSummary[]>([])
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [mcps, setMcps] = useState<McpServerSummary[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null)
  const [skillEditorOpen, setSkillEditorOpen] = useState(false)
  const [mcpEditorOpen, setMcpEditorOpen] = useState(false)
  const [mcpDetailOpen, setMcpDetailOpen] = useState(false)
  const [integrationDetail, setIntegrationDetail] = useState<IntegrationSummary | null>(null)
  const [selectedSkill, setSelectedSkill] = useState<SkillSummary | null>(null)
  const [selectedMcp, setSelectedMcp] = useState<McpServerSummary | null>(null)
  const [skillName, setSkillName] = useState('')
  const [skillDescription, setSkillDescription] = useState('')
  const [skillInstructions, setSkillInstructions] = useState('')
  const [skillPreview, setSkillPreview] = useState(false)
  const [mcpName, setMcpName] = useState('')
  const [mcpUrl, setMcpUrl] = useState('')
  const [mcpTransport, setMcpTransport] = useState<'sse' | 'streamable-http'>('streamable-http')
  const [mcpAuthType, setMcpAuthType] = useState<McpAuthType>('none')
  const [mcpBearerToken, setMcpBearerToken] = useState('')
  const [mcpHeaderName, setMcpHeaderName] = useState('')
  const [mcpHeaderValue, setMcpHeaderValue] = useState('')
  const mounted = useRef(true)
  const connectionBusy = useRef(false)
  const [disconnectable, setDisconnectable] = useState<ReadonlySet<string>>(new Set())
  const requestScope = useMemo(() => ({ workspaceId, scope }), [workspaceId, scope])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const load = useCallback(async () => {
    if (!mounted.current) return
    setLoading(true)
    try {
      const [integrationResult, skillRows, mcpRows] = await Promise.all([
        listIntegrationItems(requestScope),
        listSkills(),
        listMcpServers(),
      ])
      if (!mounted.current) return
      setDisconnectable(new Set(integrationResult.workspaceConnectors?.filter((item) => item.canDisconnect).map((item) => item.providerKey)))
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
      if (mounted.current) Alert.alert('Extensions unavailable', error instanceof Error ? error.message : 'Could not load extensions')
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [requestScope])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  const filteredIntegrations = useMemo(() => integrations.filter((item) => `${item.name} ${item.slug}`.toLowerCase().includes(query.toLowerCase())), [integrations, query])
  const filteredSkills = useMemo(() => skills.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase())), [skills, query])
  const filteredMcps = useMemo(() => mcps.filter((item) => `${item.name} ${item.url}`.toLowerCase().includes(query.toLowerCase())), [mcps, query])

  async function runIntegrationSearch(): Promise<void> {
    try {
      const result = await searchIntegrations(query, requestScope)
      if (mounted.current) setIntegrations(result.items)
    } catch (error) {
      Alert.alert('Search failed', error instanceof Error ? error.message : 'Try again.')
    }
  }

  async function pollForConnection(providerKey: string): Promise<void> {
    // Composio's hosted flow ends on a web page — the auth session returns when
    // the user dismisses it. Poll a few times so the connected row appears even
    // if the provider's link settles a beat after the browser closes.
    for (let i = 0; i < 4 && mounted.current; i++) {
      try {
        const result = await listIntegrationItems(requestScope)
        if (!mounted.current) return
        if (result.items) setIntegrations(result.items)
        const connected = result.connected.includes(providerKey) ||
          result.items?.some((item) => item.providerKey === providerKey && item.isConnected)
        if (connected) return
      } catch {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }

  function canChangeIntegration(item: IntegrationSummary): boolean {
    return !item.isConnected || scope === 'personal' || disconnectable.has(item.providerKey)
  }

  async function toggleIntegration(item: IntegrationSummary): Promise<void> {
    if (connectionBusy.current || !canChangeIntegration(item)) return
    connectionBusy.current = true
    setConnectingSlug(item.slug)
    try {
      if (item.isConnected) {
        await disconnectIntegration(item.providerKey, requestScope)
        await load()
        return
      }
      const result = await connectIntegration(item.providerKey, requestScope)
      if (!result.redirectUrl) {
        await load()
        return
      }
      if (!mounted.current) return
      try {
        await WebBrowser.openAuthSessionAsync(result.redirectUrl, INTEGRATION_RETURN_URL)
      } catch {
        // The system browser failed to open — fall back to a plain reload.
      }
      await pollForConnection(item.providerKey)
      await load()
    } catch (error) {
      if (mounted.current) Alert.alert('Integration update failed', error instanceof Error ? error.message : 'Try again.')
    } finally {
      connectionBusy.current = false
      if (mounted.current) setConnectingSlug(null)
    }
  }

  function openSkillEditor(skill: SkillSummary | null): void {
    setSelectedSkill(skill)
    setSkillName(skill?.name || '')
    setSkillDescription(skill?.description || '')
    setSkillInstructions(skill?.instructions || '')
    setSkillPreview(false)
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
    setMcpAuthType(mcp?.authType || 'none')
    setMcpBearerToken('')
    setMcpHeaderName('')
    setMcpHeaderValue('')
    setMcpEditorOpen(true)
  }

  function openMcpDetail(mcp: McpServerSummary): void {
    setSelectedMcp(mcp)
    setMcpDetailOpen(true)
  }

  function mcpAuthConfig(): Record<string, unknown> | undefined {
    if (mcpAuthType === 'bearer' && mcpBearerToken.trim()) return { bearerToken: mcpBearerToken.trim() }
    if (mcpAuthType === 'header' && mcpHeaderName.trim() && mcpHeaderValue.trim()) {
      return { headerName: mcpHeaderName.trim(), headerValue: mcpHeaderValue.trim() }
    }
    return undefined
  }

  async function saveMcp(): Promise<void> {
    if (!mcpName.trim() || !mcpUrl.trim()) {
      Alert.alert('Missing fields', 'Name and URL are required.')
      return
    }
    try {
      if (selectedMcp) {
        const patch: Parameters<typeof updateMcpServer>[1] = { name: mcpName, url: mcpUrl, transport: mcpTransport, authType: mcpAuthType }
        const authConfig = mcpAuthConfig()
        if (authConfig) patch.authConfig = authConfig
        await updateMcpServer(selectedMcp._id, patch)
      } else {
        await createMcpServer({
          name: mcpName,
          url: mcpUrl,
          transport: mcpTransport,
          enabled: true,
          authType: mcpAuthType,
          authConfig: mcpAuthConfig(),
        })
      }
      setMcpEditorOpen(false)
      await load()
    } catch (error) {
      Alert.alert('Could not save MCP server', error instanceof Error ? error.message : 'Try again.')
    }
  }

  async function testMcpForm(): Promise<void> {
    try {
      const result = await testMcpServer({ url: mcpUrl, transport: mcpTransport, authType: mcpAuthType === 'oauth' ? 'none' : mcpAuthType, authConfig: mcpAuthConfig() })
      if (result.requiresAuth) {
        Alert.alert('Server wants OAuth', 'The server answered 401 while unauthenticated. Set auth to OAuth, save, then connect.')
      } else {
        Alert.alert(result.ok ? 'Connection works' : 'Connection failed', result.ok ? `${result.toolCount ?? 0} tools found.` : result.error || 'Could not connect.')
      }
    } catch (error) {
      Alert.alert('Connection failed', error instanceof Error ? error.message : 'Try again.')
    }
  }

  const content = (() => {
    if (loading) return <ActivityIndicator color={theme.textSecondary} />
    if (tab === 'integrations') {
      return filteredIntegrations.length ? filteredIntegrations.map((item) => (
        <Row
          key={item.slug}
          theme={theme}
          icon="link"
          title={item.name}
          detail={item.isConnected ? 'Connected' : item.description || item.slug}
          onPress={() => setIntegrationDetail(item)}
          action={
            !canChangeIntegration(item) ? null : connectingSlug === item.slug ? (
              <ActivityIndicator size="small" color={theme.textSecondary} />
            ) : (
              <TouchableOpacity disabled={connectingSlug !== null} onPress={() => { void toggleIntegration(item) }}>
                <Text style={[styles.actionText, { color: theme.text }]}>{item.isConnected ? 'Disconnect' : 'Connect'}</Text>
              </TouchableOpacity>
            )
          }
        />
      )) : <EmptyState theme={theme} icon="link" title="No integrations" description="Search for apps to connect." />
    }
    if (tab === 'skills') {
      return filteredSkills.length ? filteredSkills.map((skill) => (
        <Row key={skill._id} theme={theme} icon="terminal" title={skill.name} detail={skill.description} onPress={() => openSkillEditor(skill)} action={<Switch value={skill.enabled !== false} onValueChange={(enabled) => { void updateSkill(skill._id, { enabled }).then(load) }} />} />
      )) : <EmptyState theme={theme} icon="terminal" title="No skills" description="Create reusable instructions for Overlay." />
    }
    return filteredMcps.length ? filteredMcps.map((mcp) => (
      <Row
        key={mcp._id}
        theme={theme}
        icon="server"
        title={mcp.name}
        detail={mcp.authType === 'oauth' ? `${mcp.url} · OAuth ${mcp.oauthStatus ?? 'pending'}` : mcp.url}
        onPress={() => openMcpDetail(mcp)}
        action={<Switch value={mcp.enabled !== false} onValueChange={(enabled) => { void updateMcpServer(mcp._id, { enabled }).then(load) }} />}
      />
    )) : <EmptyState theme={theme} icon="server" title="No MCP servers" description="Add MCP tools for the assistant to use." />
  })()

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
          {tab === 'integrations' && onScopeChange ? (
            <SegmentedControl
              theme={theme}
              value={scope}
              onChange={(next) => { if (!connectionBusy.current) onScopeChange(next) }}
              options={[{ label: 'Personal', value: 'personal' }, { label: 'Workspace', value: 'workspace' }]}
            />
          ) : null}
          <SearchField theme={theme} value={query} onChangeText={setQuery} placeholder={tab === 'integrations' ? 'Search apps' : 'Search extensions'} />
          <View style={styles.rows}>{content}</View>
        </ScrollView>

        <BottomSheet theme={theme} visible={skillEditorOpen} onClose={() => setSkillEditorOpen(false)} title={selectedSkill ? 'Edit Skill' : 'New Skill'}>
          <View style={styles.form}>
            <TextInput value={skillName} onChangeText={setSkillName} placeholder="Name" placeholderTextColor={theme.textDisabled} style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]} />
            <TextInput value={skillDescription} onChangeText={setSkillDescription} placeholder="Description" placeholderTextColor={theme.textDisabled} style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]} />
            <SegmentedControl
              theme={theme}
              value={skillPreview ? 'preview' : 'edit'}
              onChange={(next) => setSkillPreview(next === 'preview')}
              options={[{ label: 'Write', value: 'edit' }, { label: 'Preview', value: 'preview' }]}
            />
            {skillPreview ? (
              <View style={[styles.previewBox, { borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}>
                {skillInstructions.trim() ? (
                  <EnrichedMarkdownText
                    markdown={skillInstructions}
                    markdownStyle={skillMarkdownStyles(theme)}
                    flavor="github"
                    selectable
                  />
                ) : (
                  <Text style={[styles.previewEmpty, { color: theme.textSecondary }]}>Nothing to preview.</Text>
                )}
              </View>
            ) : (
              <TextInput value={skillInstructions} onChangeText={setSkillInstructions} placeholder="Instructions (markdown)" placeholderTextColor={theme.textDisabled} multiline style={[styles.textArea, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]} />
            )}
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
            <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Authentication</Text>
            <SegmentedControl
              theme={theme}
              value={mcpAuthType}
              onChange={setMcpAuthType}
              options={[
                { label: 'None', value: 'none' },
                { label: 'Bearer', value: 'bearer' },
                { label: 'Header', value: 'header' },
                { label: 'OAuth', value: 'oauth' },
              ]}
            />
            {mcpAuthType === 'bearer' ? (
              <TextInput value={mcpBearerToken} onChangeText={setMcpBearerToken} placeholder={selectedMcp?.hasAuth ? 'Token (saved — enter to replace)' : 'Bearer token'} placeholderTextColor={theme.textDisabled} autoCapitalize="none" secureTextEntry style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]} />
            ) : null}
            {mcpAuthType === 'header' ? (
              <>
                <TextInput value={mcpHeaderName} onChangeText={setMcpHeaderName} placeholder="Header name" placeholderTextColor={theme.textDisabled} autoCapitalize="none" style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]} />
                <TextInput value={mcpHeaderValue} onChangeText={setMcpHeaderValue} placeholder={selectedMcp?.hasAuth ? 'Header value (saved — enter to replace)' : 'Header value'} placeholderTextColor={theme.textDisabled} autoCapitalize="none" secureTextEntry style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceElevated }]} />
              </>
            ) : null}
            {mcpAuthType === 'oauth' ? (
              <Text style={[styles.oauthHint, { color: theme.textSecondary }]}>
                Save first, then connect from the server detail — OAuth needs a persisted server to attach tokens to.
              </Text>
            ) : null}
            <TouchableOpacity onPress={() => { void testMcpForm() }}><Text style={[styles.actionText, { color: theme.text }]}>Test connection</Text></TouchableOpacity>
            <View style={styles.formActions}>
              {selectedMcp ? <TouchableOpacity onPress={() => { void deleteMcpServer(selectedMcp._id).then(() => { setMcpEditorOpen(false); return load() }) }}><Text style={styles.deleteText}>Delete</Text></TouchableOpacity> : null}
              <TouchableOpacity onPress={() => { void saveMcp() }} style={[styles.primaryButton, { backgroundColor: theme.foreground }]}><Text style={[styles.primaryButtonText, { color: theme.background }]}>Save</Text></TouchableOpacity>
            </View>
          </View>
        </BottomSheet>

        <McpDetailSheet
          visible={mcpDetailOpen}
          server={selectedMcp}
          onClose={() => setMcpDetailOpen(false)}
          onEdit={() => {
            setMcpDetailOpen(false)
            openMcpEditor(selectedMcp)
          }}
          onChanged={() => { void load() }}
        />

        <BottomSheet theme={theme} visible={integrationDetail !== null} onClose={() => setIntegrationDetail(null)} title={integrationDetail?.name || 'App'}>
          {integrationDetail ? (
            <View style={styles.form}>
              <View style={styles.integrationStatusRow}>
                <StatusPill theme={theme} label={integrationDetail.isConnected ? 'Connected' : 'Not connected'} tone={integrationDetail.isConnected ? 'active' : 'default'} />
                <Text style={[styles.integrationProvider, { color: theme.textSecondary }]}>{integrationDetail.provider}</Text>
              </View>
              {integrationDetail.description ? (
                <Text style={[styles.integrationDescription, { color: theme.textSecondary }]}>{integrationDetail.description}</Text>
              ) : null}
              {integrationDetail.authenticationState && integrationDetail.authenticationState !== 'connected' && integrationDetail.authenticationState !== 'not-connected' ? (
                <Text style={styles.integrationAuthWarning}>
                  This connection looks {integrationDetail.authenticationState} — reconnect to refresh it.
                </Text>
              ) : null}
              {canChangeIntegration(integrationDetail) ? (
              <TouchableOpacity
                onPress={() => {
                  const item = integrationDetail
                  setIntegrationDetail(null)
                  void toggleIntegration(item)
                }}
                disabled={connectingSlug !== null}
                style={[styles.primaryButton, { backgroundColor: theme.foreground, alignSelf: 'stretch' }]}
              >
                {connectingSlug === integrationDetail.slug ? (
                  <ActivityIndicator size="small" color={theme.background} />
                ) : (
                  <Text style={[styles.primaryButtonText, { color: theme.background }]}>
                    {integrationDetail.isConnected ? 'Disconnect' : 'Connect'}
                  </Text>
                )}
              </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </BottomSheet>
      </SafeAreaView>
    </ScreenWithDrawer>
  )
}

function skillMarkdownStyles(theme: Theme) {
  return {
    paragraph: { color: theme.text, fontSize: 14, lineHeight: 21, marginBottom: 8 },
    h1: { color: theme.text, fontSize: 20, fontWeight: '700' as const, marginTop: 10, marginBottom: 6 },
    h2: { color: theme.text, fontSize: 17, fontWeight: '600' as const, marginTop: 8, marginBottom: 4 },
    h3: { color: theme.text, fontSize: 15, fontWeight: '600' as const, marginTop: 6, marginBottom: 4 },
    code: { backgroundColor: theme.surfaceMuted, color: theme.text, fontSize: 12, fontFamily: 'monospace' },
    codeBlock: { backgroundColor: theme.surfaceMuted, color: theme.text, fontSize: 12, fontFamily: 'monospace' },
    link: { color: theme.text, textDecorationLine: 'underline' as const },
    blockquote: { color: theme.textSecondary, borderLeftColor: theme.border },
    listItem: { color: theme.text, fontSize: 14, lineHeight: 21 },
  }
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
  sectionLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 },
  oauthHint: { fontSize: fontSize.sm, lineHeight: 19 },
  form: { gap: spacing.md },
  input: { minHeight: 46, borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.lg, paddingHorizontal: spacing.md, fontSize: fontSize.md },
  textArea: { minHeight: 140, borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.lg, padding: spacing.md, fontSize: fontSize.md, textAlignVertical: 'top' },
  previewBox: { minHeight: 140, borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.lg, padding: spacing.md },
  previewEmpty: { fontSize: fontSize.sm },
  formActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  primaryButton: { minHeight: 44, minWidth: 120, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  primaryButtonText: { fontSize: fontSize.md, fontWeight: '700' },
  deleteText: { color: '#EF4444', fontSize: fontSize.md, fontWeight: '700' },
  integrationStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  integrationProvider: { fontSize: fontSize.sm, textTransform: 'capitalize' },
  integrationDescription: { fontSize: fontSize.sm, lineHeight: 20 },
  integrationAuthWarning: { color: '#EF4444', fontSize: fontSize.sm, lineHeight: 19 },
})
