import React, { useCallback, useEffect, useMemo, useState } from 'react'
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
import { Feather } from '@expo/vector-icons'
import type { AppSettings, ChatModel } from '@overlay/app-core'
import { borderRadius, fontSize, spacing, type Theme } from '../../constants/theme'
import { BottomSheet } from '../ui/AppChrome'
import {
  effectiveEnabledModelIds,
  getGatewayModelCatalog,
  type GatewayCatalogModel,
} from '../../services/modelCatalogService'
import { ActionRow, SettingsSection, settingsStyles } from './primitives'

/**
 * Models settings section — the mobile parity of web `ModelCatalogSetting`:
 * every authorized chat model with an enable/disable toggle that persists to
 * `AppSettings.enabledChatModelIds` (empty = server curated default).
 *
 * Ordering: bootstrap `chatModels` arrive in the server's curated order, so
 * they lead; gateway-only models append alphabetically. The web's explicit
 * `modelOrder` drag ranking stays web-managed — mobile edits membership only.
 */

export function ModelsSection({
  theme,
  chatModels,
  enabledChatModelIds,
  disabled,
  onSettingsChange,
}: {
  theme: Theme
  chatModels: ChatModel[]
  enabledChatModelIds: readonly string[]
  disabled?: boolean
  onSettingsChange: (patch: Partial<AppSettings>) => Promise<unknown>
}): React.ReactElement {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [catalog, setCatalog] = useState<GatewayCatalogModel[] | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const enabled = useMemo(() => effectiveEnabledModelIds(enabledChatModelIds), [enabledChatModelIds])

  const refreshCatalog = useCallback(async (force = false) => {
    setCatalogLoading(true)
    try {
      setCatalog(await getGatewayModelCatalog(force))
      setCatalogError(null)
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : 'Model catalog unavailable')
    } finally {
      setCatalogLoading(false)
    }
  }, [])

  useEffect(() => {
    if (sheetOpen && catalog === null && !catalogLoading) {
      void refreshCatalog()
    }
  }, [sheetOpen, catalog, catalogLoading, refreshCatalog])

  // Bootstrap models lead in server order; gateway-only models append by name.
  const rows = useMemo(() => {
    const bootstrapIds = new Set(chatModels.map((model) => model.id))
    const merged: { id: string; name: string; provider: string; detail: string }[] = chatModels.map(
      (model) => ({
        id: model.id,
        name: model.name,
        provider: model.provider,
        detail: [
          model.provider,
          model.cost > 0 ? `cost ${model.cost}` : 'free',
          model.supportsVision ? 'vision' : null,
          model.supportsReasoning ? 'reasoning' : null,
        ]
          .filter(Boolean)
          .join(' · '),
      }),
    )
    const extras = (catalog ?? [])
      .filter((model) => model.type === 'language' && !bootstrapIds.has(model.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((model) => ({
        id: model.id,
        name: model.name,
        provider: model.provider,
        detail: [model.provider, ...model.tags.slice(0, 3)].filter(Boolean).join(' · '),
      }))
    const combined = [...merged, ...extras]
    const needle = query.trim().toLowerCase()
    if (!needle) return combined
    return combined.filter(
      (row) =>
        row.name.toLowerCase().includes(needle) ||
        row.id.toLowerCase().includes(needle) ||
        row.provider.toLowerCase().includes(needle),
    )
  }, [catalog, chatModels, query])

  const enabledCount = useMemo(
    () => rows.filter((row) => enabled.has(row.id)).length,
    [enabled, rows],
  )

  async function toggleModel(modelId: string, next: boolean): Promise<void> {
    if (disabled || busyId) return
    setBusyId(modelId)
    try {
      // Always write the explicit list — an empty stored list means "curated
      // default", so toggling anything materializes the effective set first.
      const nextIds = new Set(enabled)
      if (next) nextIds.add(modelId)
      else nextIds.delete(modelId)
      const orderedIds = rows.map((row) => row.id).filter((id) => nextIds.has(id))
      for (const id of nextIds) {
        if (!orderedIds.includes(id)) orderedIds.push(id)
      }
      await onSettingsChange({ enabledChatModelIds: orderedIds })
    } catch (error) {
      Alert.alert('Could not update models', error instanceof Error ? error.message : 'Try again.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <SettingsSection theme={theme} title="Models" icon="layers">
        <ActionRow
          theme={theme}
          icon="layers"
          title="Chat model catalog"
          detail={
            enabledChatModelIds.length > 0
              ? `${enabledChatModelIds.length} models enabled — picker shows your list`
              : 'Curated default list — picker shows the default set'
          }
          onPress={() => setSheetOpen(true)}
        />
        <Text style={[settingsStyles.helperText, { color: theme.textSecondary }]}>
          Enabled models appear in the chat model picker. Disable everything you never use — the
          picker gets shorter, not smarter.
        </Text>
      </SettingsSection>

      <BottomSheet
        theme={theme}
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Chat models"
        headerAction={
          <TouchableOpacity onPress={() => void refreshCatalog(true)} disabled={catalogLoading}>
            {catalogLoading ? (
              <ActivityIndicator size="small" color={theme.textSecondary} />
            ) : (
              <Feather name="refresh-cw" size={18} color={theme.textSecondary} />
            )}
          </TouchableOpacity>
        }
      >
        <View style={localStyles.sheetBody}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search models"
            placeholderTextColor={theme.textSecondary}
            style={[localStyles.search, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {catalogError ? (
            <Text style={[settingsStyles.helperText, { color: '#EF4444' }]}>{catalogError}</Text>
          ) : null}
          <Text style={[settingsStyles.helperText, { color: theme.textSecondary }]}>
            {enabledCount} enabled{enabledChatModelIds.length === 0 ? ' (default list)' : ''}
          </Text>
          <ScrollView style={localStyles.list} nestedScrollEnabled>
            {rows.map((row) => {
              const isEnabled = enabled.has(row.id)
              return (
                <View key={row.id} style={[settingsStyles.row, { borderColor: theme.border }]}>
                  <View style={settingsStyles.rowCopy}>
                    <Text style={[settingsStyles.rowTitle, { color: theme.text }]} numberOfLines={1}>
                      {row.name}
                    </Text>
                    <Text style={[settingsStyles.rowDetail, { color: theme.textSecondary }]} numberOfLines={1}>
                      {row.detail}
                    </Text>
                  </View>
                  {busyId === row.id ? (
                    <ActivityIndicator size="small" color={theme.textSecondary} />
                  ) : (
                    <Switch
                      value={isEnabled}
                      disabled={disabled}
                      onValueChange={(next) => void toggleModel(row.id, next)}
                    />
                  )}
                </View>
              )
            })}
            {rows.length === 0 ? (
              <Text style={[settingsStyles.helperText, { color: theme.textSecondary }]}>
                {query ? 'No models match the search.' : 'Model list will appear after bootstrap refreshes.'}
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </BottomSheet>
    </>
  )
}

const localStyles = StyleSheet.create({
  sheetBody: {
    gap: spacing.sm,
    maxHeight: 520,
  },
  search: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
  },
  list: {
    flexGrow: 0,
  },
})
