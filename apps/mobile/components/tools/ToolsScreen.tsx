import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as WebBrowser from 'expo-web-browser'
import { Alert } from 'react-native'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import {
  Button,
  Form,
  HStack,
  Host,
  Image as SwiftSymbol,
  Picker,
  ProgressView,
  Section,
  Spacer,
  Text as SwiftText,
  Toggle,
  VStack,
} from '@expo/ui/swift-ui'
import { buttonStyle, contentShape, font, foregroundStyle, frame, labelsHidden, lineLimit, pickerStyle, shapes, tag, tint } from '@expo/ui/swift-ui/modifiers'
import type { IntegrationSummary, McpServerSummary, SkillSummary } from '@overlay/app-core'
import { useTheme } from '../../hooks/useTheme'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useAppSession } from '../../contexts/AppSessionContext'
import { useSwitchTint } from '../../lib/nativeControls'
import { extensionsChanged } from '../../lib/changeSignal'
import { primeRecord } from './ExtensionForms'
import { NativePageSheet } from '../ui/NativePageSheet'
import { RoomConfirmDialog, type RoomConfirmation } from '../chat/RoomSheets'
import { FeatureGate } from '../ui/FeatureGate'
import { McpDetailSheet } from './McpDetailSheet'
import {
  connectIntegration,
  disconnectIntegration,
  listIntegrationItems,
  listMcpServers,
  listSkills,
  searchIntegrations,
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
  const [tab, setTab] = useState<ToolTab>('integrations')
  const [integrations, setIntegrations] = useState<IntegrationSummary[]>([])
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [mcps, setMcps] = useState<McpServerSummary[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null)
  const [mcpDetailOpen, setMcpDetailOpen] = useState(false)
  const [selectedMcp, setSelectedMcp] = useState<McpServerSummary | null>(null)
  const [confirmation, setConfirmation] = useState<RoomConfirmation | null>(null)
  const { theme, isDark } = useTheme()
  const router = useRouter()
  const switchTint = useSwitchTint()
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
  useEffect(() => extensionsChanged.subscribe(() => { void load() }), [load])

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

  function openMcpDetail(mcp: McpServerSummary): void {
    setSelectedMcp(mcp)
    setMcpDetailOpen(true)
  }

  // Connect/disconnect asks first, naming the app and what happens.
  function confirmIntegration(item: IntegrationSummary): void {
    if (!canChangeIntegration(item) || connectingSlug) return
    const stale = item.authenticationState && item.authenticationState !== 'connected' && item.authenticationState !== 'not-connected'
    setConfirmation({
      title: item.name,
      message: [
        item.description,
        stale ? `This connection looks ${item.authenticationState}. Reconnect to refresh it.` : null,
        item.isConnected ? 'Overlay will lose access to this app.' : 'You’ll sign in to this app in your browser.',
      ].filter(Boolean).join('\n\n'),
      label: item.isConnected ? 'Disconnect' : 'Connect',
      destructive: item.isConnected,
      run: () => void toggleIntegration(item),
    })
  }

  const row = (title: string, detail: string | undefined, symbol: string, trailing: React.ReactNode, onPress?: () => void) => (
    <HStack spacing={12}>
      {/* Borderless so the row's button and switch each take their own taps. */}
      <Button onPress={onPress} modifiers={[buttonStyle('borderless')]}>
        <HStack spacing={12} modifiers={[contentShape(shapes.rectangle())]}>
          <SwiftSymbol systemName={symbol as never} size={17} modifiers={[frame({ width: 26 }), secondary]} />
          <VStack alignment="leading" spacing={2}>
            <SwiftText modifiers={[lineLimit(1), foregroundStyle(theme.foreground as string)]}>{title}</SwiftText>
            {detail ? <SwiftText modifiers={[secondary, font({ size: 13 }), lineLimit(2)]}>{detail}</SwiftText> : null}
          </VStack>
          <Spacer />
        </HStack>
      </Button>
      {trailing}
    </HStack>
  )

  const list = (() => {
    if (loading) return <Section footer={<SwiftText>Loading…</SwiftText>}>{null}</Section>
    if (tab === 'integrations') {
      return filteredIntegrations.length ? (
        <Section footer={<SwiftText>{query.trim() ? 'Tap + to search all apps for this text.' : 'Tap an app to connect or disconnect it.'}</SwiftText>}>
          {filteredIntegrations.map((item) => (
            <React.Fragment key={item.slug}>
              {row(
                item.name,
                item.isConnected ? 'Connected' : item.description || item.slug,
                item.isConnected ? 'checkmark.circle.fill' : 'link',
                connectingSlug === item.slug ? <ProgressView /> : null,
                canChangeIntegration(item) ? () => confirmIntegration(item) : undefined,
              )}
            </React.Fragment>
          ))}
        </Section>
      ) : (
        <Section footer={<SwiftText>{query.trim() ? 'No apps match. Tap + to search all apps.' : 'Search for apps to connect.'}</SwiftText>}>{null}</Section>
      )
    }
    if (tab === 'skills') {
      return filteredSkills.length ? (
        <Section footer={<SwiftText>Tap a skill to edit it. The switch turns it on or off.</SwiftText>}>
          {filteredSkills.map((skill) => (
            <React.Fragment key={skill._id}>
              {row(
                skill.name,
                skill.description,
                'terminal',
                <Toggle
                  isOn={skill.enabled !== false}
                  onIsOnChange={(enabled) => { void updateSkill(skill._id, { enabled }).then(load) }}
                  modifiers={[...switchTint, labelsHidden()]}
                />,
                () => { primeRecord(skill); router.push({ pathname: '/skill-edit', params: { id: skill._id } }) },
              )}
            </React.Fragment>
          ))}
        </Section>
      ) : (
        <Section footer={<SwiftText>Create reusable instructions for Overlay with +.</SwiftText>}>{null}</Section>
      )
    }
    return filteredMcps.length ? (
      <Section footer={<SwiftText>Tap a server for its connection and sign-in. The switch turns it on or off.</SwiftText>}>
        {filteredMcps.map((mcp) => (
          <React.Fragment key={mcp._id}>
            {row(
              mcp.name,
              mcp.authType === 'oauth' ? `${mcp.url} · OAuth ${mcp.oauthStatus ?? 'pending'}` : mcp.url,
              'server.rack',
              <Toggle
                isOn={mcp.enabled !== false}
                onIsOnChange={(enabled) => { void updateMcpServer(mcp._id, { enabled }).then(load) }}
                modifiers={[...switchTint, labelsHidden()]}
              />,
              () => openMcpDetail(mcp),
            )}
          </React.Fragment>
        ))}
      </Section>
    ) : (
      <Section footer={<SwiftText>Add MCP tools for the assistant to use with +.</SwiftText>}>{null}</Section>
    )
  })()

  return (
    <>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placeholder: tab === 'integrations' ? 'Search apps' : 'Search extensions',
            hideWhenScrolling: false,
            onChangeText: (event) => setQuery(event.nativeEvent.text),
            onCancelButtonPress: () => setQuery(''),
          },
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={tab === 'integrations' ? 'magnifyingglass' : 'plus'}
          accessibilityLabel={tab === 'skills' ? 'New skill' : tab === 'mcps' ? 'New MCP server' : 'Search all apps'}
          onPress={() => (tab === 'skills' ? router.push('/skill-edit') : tab === 'mcps' ? router.push('/mcp-edit') : void runIntegrationSearch())}
        />
      </Stack.Toolbar>
      <Host style={{ flex: 1 }} colorScheme={isDark ? 'dark' : 'light'}>
        <Form modifiers={[tint(theme.foreground as string)]}>
          <Section>
            <Picker selection={tab} onSelectionChange={(value: ToolTab) => setTab(value)} modifiers={[pickerStyle('segmented')]}>
              <SwiftText modifiers={[tag('integrations')]}>Apps</SwiftText>
              <SwiftText modifiers={[tag('skills')]}>Skills</SwiftText>
              <SwiftText modifiers={[tag('mcps')]}>MCPs</SwiftText>
            </Picker>
            {tab === 'integrations' && onScopeChange ? (
              <Picker
                label="Connections for"
                selection={scope}
                onSelectionChange={(next: IntegrationScope) => { if (!connectionBusy.current) onScopeChange(next) }}
                modifiers={[pickerStyle('menu')]}
              >
                <SwiftText modifiers={[tag('personal')]}>Just me</SwiftText>
                <SwiftText modifiers={[tag('workspace')]}>Workspace</SwiftText>
              </Picker>
            ) : null}
          </Section>
          {list}
        </Form>
      </Host>

      <NativePageSheet title={selectedMcp?.name || 'MCP server'} visible={mcpDetailOpen} onClose={() => setMcpDetailOpen(false)}>
        <McpDetailSheet
          visible={mcpDetailOpen}
          server={selectedMcp}
          onClose={() => setMcpDetailOpen(false)}
          onEdit={() => {
            setMcpDetailOpen(false)
            if (selectedMcp) { primeRecord(selectedMcp); router.push({ pathname: '/mcp-edit', params: { id: selectedMcp._id } }) }
          }}
          onChanged={() => { void load() }}
        />
      </NativePageSheet>
      <RoomConfirmDialog request={confirmation} onClose={() => setConfirmation(null)} />
    </>
  )
}

const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' })
