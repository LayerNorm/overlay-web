'use client'

import { Button, toast } from '@overlay/ui/primitives'

import { useCallback, useState } from 'react'
import { AlertCircle, KeyRound, Loader2, Plus } from 'lucide-react'
import { ConfirmDialog } from '@overlay/ui/overlays'
import {
  DEFAULT_CURATED_CHAT_MODEL_IDS,
} from '@/shared/ai/gateway/model-data'
import { FREE_TIER_AUTO_MODEL_ID } from '@/shared/ai/gateway/model-types'
import type { ByokConnectionRow } from '@/shared/ai/gateway/byok-model-conversion'
import { byokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { useAppSettings } from '@/components/providers/AppSettingsProvider'
import { useByokModels } from '@/components/providers/useByokModels'
import { useGatewayModelCatalog } from '@/components/providers/useGatewayModelCatalog'
import { ProviderConnectionRow } from './ProviderConnectionRow'
import { ProviderDialog } from './ProviderDialog'
import { ConnectProviderDialog } from './ConnectProviderDialog'
import {
  getEffectiveSettingsModelIds,
  type DialogState,
} from './provider-connections-models'

// ─── Main Component ───

export function ProviderConnectionsSetting() {
  const { connections, isLoading, error, refresh, updateConnection } = useByokModels()
  const { models: gatewayModels, isLoading: gatewayLoading, refresh: refreshGateway } = useGatewayModelCatalog()
  const { settings, isSaving, updateSettings } = useAppSettings()
  const [dialog, setDialog] = useState<DialogState>(null)
  const [deleteTarget, setDeleteTarget] = useState<ByokConnectionRow | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSaved = useCallback(() => {
    void refresh()
    setDialog(null)
  }, [refresh])

  const handleDeleted = useCallback(async (connection: ByokConnectionRow) => {
    await refresh()
    const subscription = connection.providerId.startsWith('subscription:')
    const removedModelIds = new Set(
      connection.enabledModelIds.map((rawModelId) => byokModelId(connection._id, rawModelId)),
    )
    const nextEnabledModelIds = getEffectiveSettingsModelIds(settings.enabledChatModelIds)
      .filter((modelId) => !removedModelIds.has(modelId))
    const nextAskModelIds = settings.defaultAskModelIds
      .filter((modelId) => !removedModelIds.has(modelId))
    await updateSettings({
      enabledChatModelIds: nextEnabledModelIds.length > 0
        ? nextEnabledModelIds
        : [...DEFAULT_CURATED_CHAT_MODEL_IDS],
      modelOrder: settings.modelOrder.filter((modelId) => !removedModelIds.has(modelId)),
      ...(!subscription && removedModelIds.has(settings.defaultActModelId ?? '')
        ? { defaultActModelId: FREE_TIER_AUTO_MODEL_ID }
        : {}),
      ...(!subscription && nextAskModelIds.length !== settings.defaultAskModelIds.length
        ? { defaultAskModelIds: nextAskModelIds.length > 0 ? nextAskModelIds : [FREE_TIER_AUTO_MODEL_ID] }
        : {}),
    })
    setDeleteTarget(null)
  }, [refresh, settings, updateSettings])

  return (
    <div className="flex flex-col gap-4">
      {/* Header bar with Add button */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-(--muted)">
            Connect your subscriptions or API keys. Choose their models anywhere in Overlay.
          </p>
        </div>
        <Button variant="secondary" size="sm" className="shrink-0"
          type="button"
          onClick={() => setDialog({ mode: 'add' })}
          disabled={isLoading}
        >
          <Plus size={14} strokeWidth={2} />
          Add provider
        </Button>
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-sm text-(--muted)">
          <Loader2 size={16} className="mr-2 animate-spin" />
          Loading providers...
        </div>
      ) : null}

      {/* Error state */}
      {error && !isLoading ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* Connections list */}
      {!isLoading && connections.length === 0 && !error ? (
        <div className="rounded-xl border border-(--border) bg-(--surface-elevated) py-12 text-center">
          <KeyRound size={24} className="mx-auto mb-3 text-(--muted-light)" strokeWidth={1.5} />
          <p className="text-sm text-(--muted)">No provider connections yet.</p>
          <p className="mt-1 text-xs text-(--muted-light)">
            Bring a subscription or API key to get started.
          </p>
        </div>
      ) : null}

      {!isLoading && connections.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-(--border) bg-(--surface-elevated) divide-y divide-(--border)">
          {connections.map((connection) => (
            <ProviderConnectionRow
              key={connection._id}
              connection={connection}
              gatewayModels={gatewayModels}
              gatewayLoading={gatewayLoading}
              settingsEnabledModelIds={settings.enabledChatModelIds}
              settingsModelOrder={settings.modelOrder}
              settingsDisabled={isSaving}
              onSettingsChange={updateSettings}
              onRefreshConnections={refresh}
              onUpdateConnection={updateConnection}
              onRefreshGateway={refreshGateway}
              onEdit={() => setDialog({ mode: 'edit', connection })}
              onDelete={() => setDeleteTarget(connection)}
            />
          ))}
        </div>
      ) : null}

      {/* Add/Edit Dialog */}
      {dialog?.mode === 'add' || (dialog?.mode === 'edit' && dialog.connection.providerId.startsWith('subscription:')) ? (
        <ConnectProviderDialog
          connection={dialog.mode === 'edit' ? dialog.connection : undefined}
          onClose={() => setDialog(null)}
          onConnected={refresh}
        />
      ) : dialog ? (
        <ProviderDialog
          state={dialog}
          busy={busy}
          onBusyChange={setBusy}
          onClose={() => !busy && setDialog(null)}
          onSaved={handleSaved}
        />
      ) : null}

      {/* Delete Confirmation */}
      {deleteTarget ? (
        <ConfirmDialog
          isOpen={true}
          title="Disconnect provider"
          description={`Disconnect "${deleteTarget.displayName}"? Its models will leave your dropdown. Chats using this subscription will need a new connection or an explicitly selected model.`}
          confirmLabel="Disconnect"
          destructive
          busy={busy}
          onConfirm={async () => {
            if (busy) return
            setBusy(true)
            try {
              const res = await fetch(`/api/v1/providers/connections?connectionId=${deleteTarget._id}`, {
                method: 'DELETE',
              })
              if (!res.ok) throw new Error('Could not disconnect the provider. Try again.')
              await handleDeleted(deleteTarget)
            } catch (value) {
              toast.error(value instanceof Error ? value.message : 'Could not disconnect the provider.')
            } finally {
              setBusy(false)
            }
          }}
          onCancel={() => !busy && setDeleteTarget(null)}
        />
      ) : null}
    </div>
  )
}
