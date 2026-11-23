import React, { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { Feather } from '@expo/vector-icons'
import type { McpServerSummary } from '@overlay/app-core'
import { useTheme } from '../../hooks/useTheme'
import { borderRadius, fontSize, spacing } from '../../constants/theme'
import { StatusPill } from '../ui/AppChrome'
import {
  disconnectMcpOAuth,
  startMcpOAuth,
  testMcpServer,
} from '../../services/integrationsService'

const MCP_OAUTH_CALLBACK = 'overlay://auth/mcp-callback'

function oauthStatusLabel(server: McpServerSummary): string {
  switch (server.oauthStatus) {
    case 'connected':
      return 'Connected'
    case 'pending':
      return 'Pending'
    case 'needs_reauth':
      return 'Needs re-auth'
    default:
      return 'Not connected'
  }
}

export function McpDetailSheet({
  visible,
  server,
  onClose,
  onEdit,
  onChanged,
}: {
  visible: boolean
  server: McpServerSummary | null
  onClose: () => void
  onEdit: () => void
  onChanged: () => void
}): React.ReactElement {
  const { theme } = useTheme()
  const [oauthBusy, setOauthBusy] = useState(false)
  const [testing, setTesting] = useState(false)

  async function connectOAuth(): Promise<void> {
    if (!server) return
    setOauthBusy(true)
    try {
      const started = await startMcpOAuth({ mcpServerId: server._id })
      if (started.alreadyConnected) {
        onChanged()
        return
      }
      if (started.error || !started.redirectUrl) {
        Alert.alert('Could not start sign-in', started.error || 'No authorization URL was returned.')
        return
      }
      // surface:'desktop' makes the callback finish on overlay://auth/mcp-callback
      // after the confirmation page — ASWebAuthenticationSession captures it.
      const result = await WebBrowser.openAuthSessionAsync(started.redirectUrl, MCP_OAUTH_CALLBACK)
      if (result.type === 'success') {
        const status = new URL(result.url).searchParams.get('status')
        if (status === 'error') {
          const reason = new URL(result.url).searchParams.get('reason')
          Alert.alert('Connection failed', reason || 'The authorization server reported an error.')
        }
      }
      onChanged()
    } catch (error) {
      Alert.alert('Could not start sign-in', error instanceof Error ? error.message : 'Try again.')
    } finally {
      setOauthBusy(false)
    }
  }

  async function disconnectOAuth(): Promise<void> {
    if (!server) return
    setOauthBusy(true)
    try {
      await disconnectMcpOAuth(server._id)
      onChanged()
    } catch (error) {
      Alert.alert('Could not disconnect', error instanceof Error ? error.message : 'Try again.')
    } finally {
      setOauthBusy(false)
    }
  }

  async function test(): Promise<void> {
    if (!server) return
    setTesting(true)
    try {
      // Omit authType/authConfig — when mcpServerId is present the route tests
      // with the stored server's credentials (incl. OAuth tokens from storage).
      const result = await testMcpServer({
        url: server.url,
        transport: server.transport,
        mcpServerId: server._id,
      })
      if (result.requiresAuth) {
        Alert.alert(
          'Server wants OAuth',
          'The server answered 401 while unauthenticated. Set auth to OAuth and connect.',
        )
      } else {
        Alert.alert(
          result.ok ? 'Connection works' : 'Connection failed',
          result.ok ? `${result.toolCount ?? 0} tools found.` : result.error || 'Could not connect.',
        )
      }
      onChanged()
    } catch (error) {
      Alert.alert('Connection failed', error instanceof Error ? error.message : 'Try again.')
    } finally {
      setTesting(false)
    }
  }

  const isOAuth = server?.authType === 'oauth'

  return (
    // Rendered inside a NativePageSheet, which owns presentation and the title.
    <ScrollView contentContainerStyle={{ paddingTop: 4, paddingBottom: 24 }}>
      {!server ? (
        <ActivityIndicator color={theme.textSecondary} />
      ) : (
        <View style={styles.body}>
          <View style={styles.statusRow}>
            <StatusPill
              theme={theme}
              label={server.enabled === false ? 'Disabled' : 'Enabled'}
              tone={server.enabled === false ? 'default' : 'active'}
            />
            <Text style={[styles.transport, { color: theme.textSecondary }]}>
              {server.transport === 'sse' ? 'SSE' : 'HTTP'}
            </Text>
          </View>
          <Text style={[styles.url, { color: theme.textSecondary }]} numberOfLines={2}>{server.url}</Text>

          <View style={[styles.infoCard, { borderColor: theme.border }]}>
            <InfoRow theme={theme} label="Auth" value={server.authType ?? 'none'} />
            {isOAuth ? (
              <>
                <InfoRow theme={theme} label="OAuth" value={oauthStatusLabel(server)} />
                {server.oauthIssuer ? <InfoRow theme={theme} label="Issuer" value={server.oauthIssuer} /> : null}
                {server.oauthConnectedAt ? (
                  <InfoRow theme={theme} label="Connected" value={new Date(server.oauthConnectedAt).toLocaleDateString()} />
                ) : null}
              </>
            ) : null}
            <InfoRow
              theme={theme}
              label="Tool catalog"
              value={
                server.toolCatalogCount != null
                  ? `${server.toolCatalogCount} tools`
                  : 'Not discovered'
              }
            />
            {server.toolCatalogError ? (
              <Text style={styles.catalogError} numberOfLines={3}>{server.toolCatalogError}</Text>
            ) : null}
            {server.oauthError ? (
              <Text style={styles.catalogError} numberOfLines={3}>{server.oauthError}</Text>
            ) : null}
          </View>

          <View style={styles.actions}>
            {isOAuth && server.oauthStatus !== 'connected' ? (
              <TouchableOpacity
                onPress={() => void connectOAuth()}
                disabled={oauthBusy || testing}
                style={[styles.actionChip, { backgroundColor: theme.foreground }]}
              >
                {oauthBusy ? <ActivityIndicator size="small" color={theme.background} /> : <Feather name="key" size={13} color={theme.background} />}
                <Text style={[styles.actionChipText, { color: theme.background }]}>
                  {server.oauthStatus === 'needs_reauth' ? 'Re-authorize' : 'Connect OAuth'}
                </Text>
              </TouchableOpacity>
            ) : null}
            {isOAuth && server.oauthStatus === 'connected' ? (
              <TouchableOpacity
                onPress={() => void disconnectOAuth()}
                disabled={oauthBusy || testing}
                style={[styles.actionChip, { borderColor: '#EF4444' }]}
              >
                {oauthBusy ? <ActivityIndicator size="small" color="#EF4444" /> : <Text style={styles.destructiveText}>Disconnect OAuth</Text>}
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() => void test()}
              disabled={oauthBusy || testing}
              style={[styles.actionChip, { borderColor: theme.border }]}
            >
              {testing ? <ActivityIndicator size="small" color={theme.text} /> : <Feather name="zap" size={13} color={theme.text} />}
              <Text style={[styles.actionChipText, { color: theme.text }]}>Test</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onEdit} style={[styles.actionChip, { borderColor: theme.border }]}>
              <Feather name="edit-2" size={13} color={theme.text} />
              <Text style={[styles.actionChipText, { color: theme.text }]}>Edit</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
  )
}

function InfoRow({ theme, label, value }: { theme: ReturnType<typeof useTheme>['theme']; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: theme.text }]} numberOfLines={2}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  transport: { fontSize: fontSize.sm, fontWeight: '600' },
  url: { fontSize: fontSize.sm },
  infoCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.xl, padding: spacing.md, gap: spacing.sm },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  infoLabel: { fontSize: fontSize.sm },
  infoValue: { fontSize: fontSize.sm, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  catalogError: { color: '#EF4444', fontSize: 11, lineHeight: 15 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actionChip: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: borderRadius.full, borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent', flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionChipText: { fontSize: fontSize.sm, fontWeight: '600' },
  destructiveText: { color: '#EF4444', fontSize: fontSize.sm, fontWeight: '600' },
})
