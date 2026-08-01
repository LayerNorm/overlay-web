'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Boxes, Loader2, Plus, Search, Trash2 } from 'lucide-react'
import type {
  AdminCatalogResource,
  AdminCatalogResourceType,
  KnowledgeBaseShareDirectoryResponse,
} from '@overlay/api-client'
import type {
  AuthorizationPrincipalType,
  ResourceGrant,
} from '@overlay/authz-contracts'
import { IconButton, SegmentedControl } from '@overlay/ui'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { Select } from '@overlay/ui/primitives'

const EMPTY_DIRECTORY: KnowledgeBaseShareDirectoryResponse = { users: [], groups: [], roles: [] }

export function CatalogPolicyAdminPanel({ canManage }: { canManage: boolean }) {
  const [resources, setResources] = useState<AdminCatalogResource[]>([])
  const [directory, setDirectory] = useState(EMPTY_DIRECTORY)
  const [resourceType, setResourceType] = useState<AdminCatalogResourceType>('model')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [grants, setGrants] = useState<ResourceGrant[]>([])
  const [principalType, setPrincipalType] = useState<AuthorizationPrincipalType>('group')
  const [principalId, setPrincipalId] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const visibleResources = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return resources.filter((resource) => (
      resource.resourceType === resourceType
      && (!normalized || [
        resource.id,
        resource.label,
        resource.category,
        resource.description,
      ].some((value) => value?.toLowerCase().includes(normalized)))
    ))
  }, [query, resourceType, resources])
  const selected = resources.find((resource) => (
    resource.resourceType === resourceType && resource.id === selectedId
  )) ?? null

  const load = useCallback(async () => {
    const [catalog, shareDirectory] = await Promise.all([
      overlayAppClient.adminAuthorization.listCatalogResources(),
      overlayAppClient.knowledgeBases.listShareDirectory(),
    ])
    setResources(catalog)
    setDirectory(shareDirectory)
  }, [])

  const loadGrants = useCallback(async (
    selectedType: AdminCatalogResourceType,
    resourceId: string,
  ) => {
    setGrants(await overlayAppClient.adminAuthorization.listResourceGrants({
      resourceType: selectedType,
      resourceId,
    }))
  }, [])

  useEffect(() => {
    void load().catch((loadError) => setError(message(loadError)))
  }, [load])

  useEffect(() => {
    const firstId = resources.find((resource) => resource.resourceType === resourceType)?.id ?? null
    setSelectedId((current) => (
      current && resources.some((resource) => (
        resource.resourceType === resourceType && resource.id === current
      ))
        ? current
        : firstId
    ))
  }, [resourceType, resources])

  useEffect(() => {
    if (!selectedId) {
      setGrants([])
      return
    }
    void loadGrants(resourceType, selectedId).catch((loadError) => setError(message(loadError)))
  }, [loadGrants, resourceType, selectedId])

  async function addGrant() {
    if (!selected || !principalId || busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await overlayAppClient.adminAuthorization.upsertResourceGrantResponse({
        resourceType: selected.resourceType,
        resourceId: selected.id,
        principalType,
        principalId,
        accessRole: 'viewer',
      })
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(payload.error || 'Could not update catalog policy')
      setPrincipalId('')
      await loadGrants(selected.resourceType, selected.id)
    } catch (grantError) {
      setError(message(grantError))
    } finally {
      setBusy(false)
    }
  }

  async function removeGrant(grantId: string) {
    if (!selected || busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await overlayAppClient.adminAuthorization.removeResourceGrantResponse(grantId)
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(payload.error || 'Could not remove catalog policy')
      await loadGrants(selected.resourceType, selected.id)
    } catch (grantError) {
      setError(message(grantError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section data-testid="admin-catalog-policy">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Boxes size={17} />
            <h2 className="text-sm font-semibold">Models, tools, and connectors</h2>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-[var(--muted)]">
            Restrict deployment-enabled resources to selected users, groups, or roles.
            A resource with no grants remains available to everyone who has its capability.
          </p>
        </div>
        <SegmentedControl
          value={resourceType}
          options={[
            { value: 'model', label: 'Models' },
            { value: 'tool', label: 'Tools' },
            { value: 'connector', label: 'Connectors' },
          ]}
          onChange={setResourceType}
          ariaLabel="Catalog resource type"
        />
      </div>

      {error ? <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="mt-6 grid min-h-[480px] gap-6 lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.4fr)]">
        <div className="min-w-0 border-r-0 border-[var(--border)] lg:border-r lg:pr-6">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-[var(--muted)]" size={14} />
            <input
              aria-label={`Search ${resourceType}s`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${resourceType}s`}
              className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 text-sm"
            />
          </div>
          <div className="mt-3 divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {visibleResources.length === 0 ? (
              <p className="py-5 text-sm text-[var(--muted)]">No matching resources.</p>
            ) : visibleResources.map((resource) => (
              <button
                key={`${resource.resourceType}:${resource.id}`}
                type="button"
                onClick={() => setSelectedId(resource.id)}
                className={`w-full px-2 py-3 text-left transition-colors ${
                  selectedId === resource.id
                    ? 'bg-[var(--surface-subtle)]'
                    : 'hover:bg-[var(--surface-subtle)]'
                }`}
              >
                <p className="truncate text-sm font-medium">{resource.label}</p>
                <p className="mt-1 truncate text-xs text-[var(--muted)]">
                  {resource.category ? `${resource.category} · ` : ''}{resource.id}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          {!selected ? (
            <p className="py-10 text-sm text-[var(--muted)]">Select a resource to manage availability.</p>
          ) : (
            <>
              <h3 className="text-base font-semibold">{selected.label}</h3>
              <p className="mt-1 break-all text-xs text-[var(--muted)]">{selected.id}</p>
              {selected.description ? (
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{selected.description}</p>
              ) : null}
              <p className="mt-4 text-xs text-[var(--muted)]">
                {grants.length === 0
                  ? 'Unrestricted within the deployment capability boundary.'
                  : `Restricted to ${grants.length} assigned principal${grants.length === 1 ? '' : 's'}.`}
              </p>

              {canManage ? (
                <div className="mt-6 grid gap-2 sm:grid-cols-[100px_minmax(0,1fr)_auto]">
                  <Select
                    aria-label="Catalog principal type"
                    value={principalType}
                    onChange={(event) => {
                      setPrincipalType(event.target.value as AuthorizationPrincipalType)
                      setPrincipalId('')
                    }}
                    className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs"
                  >
                    <option value="user">User</option>
                    <option value="group">Group</option>
                    <option value="role">Role</option>
                  </Select>
                  <Select
                    aria-label="Catalog policy principal"
                    value={principalId}
                    onChange={(event) => setPrincipalId(event.target.value)}
                    className="h-9 min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs"
                  >
                    <option value="">Select {principalType}</option>
                    {directoryEntries(directory, principalType).map((entry) => (
                      <option key={entry.id} value={entry.id}>{entryLabel(entry)}</option>
                    ))}
                  </Select>
                  <IconButton
                    aria-label="Restrict catalog resource to principal"
                    onClick={() => void addGrant()}
                    disabled={!principalId || busy}
                  >
                    {busy ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />}
                  </IconButton>
                </div>
              ) : null}

              <div className="mt-4 divide-y divide-[var(--border)] border-y border-[var(--border)]">
                {grants.length === 0 ? (
                  <p className="py-5 text-sm text-[var(--muted)]">No principal restrictions.</p>
                ) : grants.map((grant) => (
                  <div key={grant.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{principalLabel(directory, grant)}</p>
                      <p className="text-xs text-[var(--muted)]">{grant.principalType}</p>
                    </div>
                    {canManage ? (
                      <IconButton
                        aria-label="Remove catalog resource restriction"
                        onClick={() => void removeGrant(grant.id)}
                        disabled={busy}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function directoryEntries(
  directory: KnowledgeBaseShareDirectoryResponse,
  type: AuthorizationPrincipalType,
) {
  if (type === 'user') return directory.users
  if (type === 'group') return directory.groups
  return directory.roles
}

function entryLabel(entry: KnowledgeBaseShareDirectoryResponse['users'][number]): string {
  if (entry.email && entry.name && entry.name !== entry.email) return `${entry.name} (${entry.email})`
  return entry.email || entry.name || entry.id
}

function principalLabel(
  directory: KnowledgeBaseShareDirectoryResponse,
  grant: ResourceGrant,
): string {
  const entry = directoryEntries(directory, grant.principalType)
    .find(({ id }) => id === grant.principalId)
  return entry ? entryLabel(entry) : grant.principalId
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Catalog policy request failed'
}
