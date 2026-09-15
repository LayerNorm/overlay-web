import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { borderRadius, fontSize, spacing, type Theme } from '../../constants/theme'
import { BottomSheet } from '../ui/AppChrome'
import {
  BYOK_PROVIDER_PRESETS,
  createProviderConnection,
  deleteProviderConnection,
  discoveredModelsOf,
  getByokPreset,
  listProviderConnections,
  testProviderConnection,
  updateProviderConnection,
  type ByokProviderPreset,
  type ProviderConnection,
} from '../../services/providersService'
import { ActionRow, InfoRow, SettingsSection, settingsStyles } from './primitives'

/**
 * Providers settings section — BYOK (bring-your-own-key) connections, the
 * mobile parity of web `ProviderConnectionsSetting` + `ProviderDialog`.
 *
 * API keys are write-only: the server stores them in its credential store and
 * never returns them, so edit fields start blank and only a non-empty entry
 * rotates the key. "Test" exercises the provider's model-discovery endpoint
 * through the server — keys never leave the app except over the authenticated
 * API channel.
 */

export function ProvidersSection({ theme }: { theme: Theme }): React.ReactElement {
  const [connections, setConnections] = useState<ProviderConnection[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<ProviderConnection | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setConnections(await listProviderConnections())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Provider list unavailable')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <>
      <SettingsSection
        theme={theme}
        title="Providers"
        icon="key"
        accessory={
          <TouchableOpacity onPress={() => setAddOpen(true)} hitSlop={8}>
            <Feather name="plus" size={20} color={theme.textSecondary} />
          </TouchableOpacity>
        }
      >
        {loading && connections === null ? (
          <ActivityIndicator size="small" color={theme.textSecondary} />
        ) : error ? (
          <Text style={[settingsStyles.helperText, { color: '#EF4444' }]}>{error}</Text>
        ) : (connections ?? []).length === 0 ? (
          <Text style={[settingsStyles.helperText, { color: theme.textSecondary }]}>
            No provider connections. Add one to use your own OpenAI-compatible API keys.
          </Text>
        ) : (
          (connections ?? []).map((connection) => (
            <ProviderRow
              key={connection._id}
              theme={theme}
              connection={connection}
              onPress={() => setDetail(connection)}
            />
          ))
        )}
      </SettingsSection>

      <ProviderDetailSheet
        theme={theme}
        connection={detail}
        onClose={() => setDetail(null)}
        onChanged={() => {
          setDetail(null)
          void refresh()
        }}
      />
      <AddProviderSheet
        theme={theme}
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => {
          setAddOpen(false)
          void refresh()
        }}
      />
    </>
  )
}

function ProviderRow({
  theme,
  connection,
  onPress,
}: {
  theme: Theme
  connection: ProviderConnection
  onPress: () => void
}): React.ReactElement {
  const statusColor =
    connection.status === 'active' ? '#22C55E' : connection.status === 'error' ? '#EF4444' : theme.textSecondary
  const modelCount = discoveredModelsOf(connection).length || connection.enabledModelIds.length
  return (
    <TouchableOpacity activeOpacity={0.82} onPress={onPress} style={[settingsStyles.row, { borderColor: theme.border }]}>
      <View style={[localStyles.statusDot, { backgroundColor: statusColor }]} />
      <View style={settingsStyles.rowCopy}>
        <Text style={[settingsStyles.rowTitle, { color: theme.text }]} numberOfLines={1}>
          {connection.displayName}
        </Text>
        <Text style={[settingsStyles.rowDetail, { color: theme.textSecondary }]} numberOfLines={1}>
          {connection.providerId}
          {modelCount > 0 ? ` · ${modelCount} models` : ''}
          {connection.isDefault ? ' · built-in' : ''}
        </Text>
      </View>
      <Feather name="chevron-right" size={16} color={theme.textSecondary} />
    </TouchableOpacity>
  )
}

function ProviderDetailSheet({
  theme,
  connection,
  onClose,
  onChanged,
}: {
  theme: Theme
  connection: ProviderConnection | null
  onClose: () => void
  onChanged: () => void
}): React.ReactElement {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [newApiKey, setNewApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  const preset = connection ? getByokPreset(connection.providerId) : undefined
  const discovered = useMemo(
    () => (connection ? discoveredModelsOf(connection) : []),
    [connection],
  )

  useEffect(() => {
    setTestResult(null)
    setNewApiKey('')
  }, [connection?._id])

  if (!connection) {
    return <BottomSheet theme={theme} visible={false} onClose={onClose} title="Provider" children={null} />
  }

  async function runTest(): Promise<void> {
    if (!connection) return
    setTesting(true)
    setTestResult(null)
    try {
      // Stored-connection test: the server uses the saved API key.
      const result = await testProviderConnection({ connectionId: connection._id })
      setTestResult(
        result.ok
          ? `Connected — ${result.models.length} models discovered`
          : result.error ?? 'Connection test failed',
      )
      if (result.ok) {
        // Persist the fresh discovery so the list shows the new model count.
        await updateProviderConnection({
          connectionId: connection._id,
          status: 'active',
          lastTestedAt: Date.now(),
          discoveredModelsJson: JSON.stringify({ data: result.models }),
          discoveredAt: Date.now(),
          enabledModelIds: result.models.map((model) => model.id),
        })
        onChanged()
      }
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : 'Connection test failed')
    } finally {
      setTesting(false)
    }
  }

  async function rotateKey(): Promise<void> {
    if (!connection || !newApiKey.trim()) return
    setSaving(true)
    try {
      await updateProviderConnection({ connectionId: connection._id, apiKey: newApiKey.trim() })
      setNewApiKey('')
      Alert.alert('API key updated', 'Test the connection to confirm the new key works.')
      onChanged()
    } catch (error) {
      Alert.alert('Could not update key', error instanceof Error ? error.message : 'Try again.')
    } finally {
      setSaving(false)
    }
  }

  function confirmDelete(): void {
    if (!connection) return
    Alert.alert('Remove connection', `Delete ${connection.displayName}? Its API key is deleted too.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteProviderConnection(connection._id)
            onChanged()
          } catch (error) {
            Alert.alert('Could not delete', error instanceof Error ? error.message : 'Try again.')
          }
        },
      },
    ])
  }

  return (
    <BottomSheet theme={theme} visible onClose={onClose} title={connection.displayName}>
      <View style={localStyles.sheetBody}>
        <InfoRow theme={theme} label="Provider" value={connection.providerId} />
        <InfoRow theme={theme} label="Status" value={connection.status} />
        <InfoRow theme={theme} label="Endpoint" value={connection.endpoint} />
        {connection.lastError ? (
          <Text style={[settingsStyles.helperText, { color: '#EF4444' }]}>{connection.lastError}</Text>
        ) : null}
        <Text style={[settingsStyles.helperText, { color: theme.textSecondary }]}>
          {discovered.length > 0
            ? `${discovered.length} discovered models · ${connection.enabledModelIds.length} enabled for chat`
            : `${connection.enabledModelIds.length} models enabled for chat`}
        </Text>
        <View style={localStyles.buttonRow}>
          <SheetButton theme={theme} title={testing ? 'Testing…' : 'Test connection'} onPress={() => void runTest()} disabled={testing || saving} />
          {preset?.docsURL ? (
            <SheetButton theme={theme} title="Docs" onPress={() => void Linking.openURL(preset.docsURL)} subtle />
          ) : null}
        </View>
        {testResult ? (
          <Text style={[settingsStyles.helperText, { color: testResult.startsWith('Connected') ? '#22C55E' : '#EF4444' }]}>
            {testResult}
          </Text>
        ) : null}
        {!connection.isDefault ? (
          <>
            <Text style={[settingsStyles.fieldLabel, { color: theme.textSecondary }]}>Rotate API key</Text>
            <TextInput
              value={newApiKey}
              onChangeText={setNewApiKey}
              placeholder="New API key (saved keys are never shown)"
              placeholderTextColor={theme.textSecondary}
              style={[localStyles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <View style={localStyles.buttonRow}>
              <SheetButton theme={theme} title="Save key" onPress={() => void rotateKey()} disabled={saving || !newApiKey.trim()} />
              {connection.isDeletable ? (
                <SheetButton theme={theme} title="Delete" onPress={confirmDelete} destructive />
              ) : null}
            </View>
          </>
        ) : (
          <Text style={[settingsStyles.helperText, { color: theme.textSecondary }]}>
            This is the built-in Overlay provider — it cannot be edited or removed.
          </Text>
        )}
      </View>
    </BottomSheet>
  )
}

function AddProviderSheet({
  theme,
  visible,
  onClose,
  onCreated,
}: {
  theme: Theme
  visible: boolean
  onClose: () => void
  onCreated: () => void
}): React.ReactElement {
  const [preset, setPreset] = useState<ByokProviderPreset>(BYOK_PROVIDER_PRESETS[0])
  const [displayName, setDisplayName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  useEffect(() => {
    if (visible) {
      setPreset(BYOK_PROVIDER_PRESETS[0])
      setDisplayName('')
      setEndpoint('')
      setApiKey('')
      setTestResult(null)
    }
  }, [visible])

  const effectiveEndpoint = preset.allowsCustomEndpoint ? endpoint.trim() : preset.defaultBaseURL
  const canSave =
    !busy &&
    displayName.trim().length > 0 &&
    (!preset.requiresApiKey || apiKey.trim().length > 0) &&
    (!preset.allowsCustomEndpoint || effectiveEndpoint.startsWith('https://'))

  async function testBeforeSave(): Promise<void> {
    setBusy(true)
    setTestResult(null)
    try {
      const result = await testProviderConnection({
        providerId: preset.id,
        ...(effectiveEndpoint ? { endpoint: effectiveEndpoint } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
      setTestResult(
        result.ok
          ? `Connected — ${result.models.length} models discovered`
          : result.error ?? 'Connection test failed',
      )
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : 'Connection test failed')
    } finally {
      setBusy(false)
    }
  }

  async function save(): Promise<void> {
    if (!canSave) return
    setBusy(true)
    try {
      await createProviderConnection({
        providerId: preset.id,
        displayName: displayName.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(preset.allowsCustomEndpoint && effectiveEndpoint ? { endpoint: effectiveEndpoint } : {}),
      })
      onCreated()
    } catch (error) {
      Alert.alert('Could not add provider', error instanceof Error ? error.message : 'Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet theme={theme} visible={visible} onClose={onClose} title="Add provider">
      <View style={localStyles.sheetBody}>
        <Text style={[settingsStyles.fieldLabel, { color: theme.textSecondary }]}>Provider</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={localStyles.presetRow}>
          {BYOK_PROVIDER_PRESETS.map((option) => {
            const active = option.id === preset.id
            return (
              <TouchableOpacity
                key={option.id}
                activeOpacity={0.82}
                onPress={() => setPreset(option)}
                style={[
                  localStyles.presetChip,
                  {
                    borderColor: active ? theme.foreground : theme.border,
                    backgroundColor: active ? theme.surfaceSubtle : theme.surfaceElevated,
                  },
                ]}
              >
                <Text style={[localStyles.presetLabel, { color: active ? theme.text : theme.textSecondary }]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          placeholder={`Display name (e.g. ${preset.label})`}
          placeholderTextColor={theme.textSecondary}
          style={[localStyles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
          autoCapitalize="words"
        />
        {preset.allowsCustomEndpoint ? (
          <TextInput
            value={endpoint}
            onChangeText={setEndpoint}
            placeholder="https://your-endpoint/v1"
            placeholderTextColor={theme.textSecondary}
            style={[localStyles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        ) : (
          <InfoRow theme={theme} label="Endpoint" value={preset.defaultBaseURL} />
        )}
        <TextInput
          value={apiKey}
          onChangeText={setApiKey}
          placeholder={preset.requiresApiKey ? 'API key (required)' : 'API key (optional)'}
          placeholderTextColor={theme.textSecondary}
          style={[localStyles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <Text style={[settingsStyles.helperText, { color: theme.textSecondary }]}>
          Keys are stored server-side in the credential store — never in this app's local storage.
        </Text>
        {testResult ? (
          <Text style={[settingsStyles.helperText, { color: testResult.startsWith('Connected') ? '#22C55E' : '#EF4444' }]}>
            {testResult}
          </Text>
        ) : null}
        <View style={localStyles.buttonRow}>
          <SheetButton theme={theme} title={busy ? 'Working…' : 'Test'} onPress={() => void testBeforeSave()} disabled={busy || (!preset.requiresApiKey && !apiKey.trim() && !effectiveEndpoint)} subtle />
          <SheetButton theme={theme} title="Add provider" onPress={() => void save()} disabled={!canSave} />
        </View>
      </View>
    </BottomSheet>
  )
}

function SheetButton({
  theme,
  title,
  onPress,
  disabled,
  destructive,
  subtle,
}: {
  theme: Theme
  title: string
  onPress: () => void
  disabled?: boolean
  destructive?: boolean
  subtle?: boolean
}): React.ReactElement {
  const background = destructive ? '#EF4444' : subtle ? theme.surfaceSubtle : theme.foreground
  const color = destructive ? '#fff' : subtle ? theme.text : theme.background
  return (
    <TouchableOpacity
      activeOpacity={0.82}
      onPress={onPress}
      disabled={disabled}
      style={[localStyles.button, { backgroundColor: background, opacity: disabled ? 0.5 : 1 }]}
    >
      <Text style={[localStyles.buttonText, { color }]}>{title}</Text>
    </TouchableOpacity>
  )
}

const localStyles = StyleSheet.create({
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: borderRadius.full,
  },
  sheetBody: {
    gap: spacing.sm,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  button: {
    flex: 1,
    minHeight: 42,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  buttonText: {
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  presetRow: {
    gap: spacing.sm,
    paddingVertical: 2,
  },
  presetChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  presetLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
})