'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  BookOpen,
  Database,
  ExternalLink,
  Loader2,
  Plus,
  Search,
  Trash2,
  Users,
} from 'lucide-react'
import type { GroupKnowledgeBaseDefault } from '@overlay/app-core'
import type {
  AdministrativeKnowledgeBase,
  KnowledgeBaseShareDirectoryResponse,
} from '@overlay/api-client'
import type {
  AuthorizationPrincipalType,
  ResourceAccessRole,
  ResourceGrant,
} from '@overlay/authz-contracts'
import { Button, IconButton } from '@overlay/ui'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { Select } from '@overlay/ui/primitives'

const EMPTY_DIRECTORY: KnowledgeBaseShareDirectoryResponse = { users: [], groups: [], roles: [] }

export function KnowledgeAdminPanel({ canManage }: { canManage: boolean }) {
  const [knowledgeBases, setKnowledgeBases] = useState<AdministrativeKnowledgeBase[]>([])
  const [directory, setDirectory] = useState(EMPTY_DIRECTORY)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [grants, setGrants] = useState<ResourceGrant[]>([])
  const [defaults, setDefaults] = useState<GroupKnowledgeBaseDefault[]>([])
  const [query, setQuery] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [principalType, setPrincipalType] = useState<AuthorizationPrincipalType>('group')
  const [principalId, setPrincipalId] = useState('')
  const [accessRole, setAccessRole] = useState<Exclude<ResourceAccessRole, 'owner'>>('viewer')
  const [defaultGroupId, setDefaultGroupId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = knowledgeBases.find(({ id }) => id === selectedId) ?? null
  const selectedDefaults = defaults.filter(({ knowledgeBaseId }) => knowledgeBaseId === selectedId)
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return knowledgeBases
    return knowledgeBases.filter((base) => [base.title, base.description, base.ownerUserId]
      .some((value) => value?.toLowerCase().includes(normalized)))
  }, [knowledgeBases, query])

  const load = useCallback(async () => {
    const [basesResponse, directoryResponse, defaultsResponse] = await Promise.all([
      overlayAppClient.knowledgeBases.listAdministrative(),
      overlayAppClient.knowledgeBases.listShareDirectory(),
      overlayAppClient.knowledgeBases.listGroupDefaults(),
    ])
    setKnowledgeBases(basesResponse.knowledgeBases)
    setDirectory(directoryResponse)
    setDefaults(defaultsResponse.defaults)
    setSelectedId((current) => current && basesResponse.knowledgeBases.some(({ id }) => id === current)
      ? current
      : basesResponse.knowledgeBases[0]?.id ?? null)
  }, [])

  const loadGrants = useCallback(async (knowledgeBaseId: string) => {
    setGrants(await overlayAppClient.adminAuthorization.listResourceGrants({
      resourceType: 'knowledge_base',
      resourceId: knowledgeBaseId,
    }))
  }, [])

  useEffect(() => {
    void load().catch((loadError) => setError(message(loadError)))
  }, [load])

  useEffect(() => {
    if (!selectedId) {
      setGrants([])
      return
    }
    void loadGrants(selectedId).catch((loadError) => setError(message(loadError)))
  }, [loadGrants, selectedId])

  async function createOrganizationKnowledgeBase() {
    if (!title.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await overlayAppClient.knowledgeBases.create({
        title: title.trim(),
        description: description.trim() || undefined,
        kind: 'organization',
      })
      setTitle('')
      setDescription('')
      await load()
      setSelectedId(response.knowledgeBase.id)
    } catch (createError) {
      setError(message(createError))
    } finally {
      setBusy(false)
    }
  }

  async function addGrant() {
    if (!selected || !principalId || busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await overlayAppClient.adminAuthorization.upsertResourceGrantResponse({
        resourceType: 'knowledge_base',
        resourceId: selected.id,
        principalType,
        principalId,
        accessRole,
      })
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(payload.error || 'Could not grant knowledge access')
      setPrincipalId('')
      await Promise.all([load(), loadGrants(selected.id)])
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
      if (!response.ok) throw new Error(payload.error || 'Could not revoke knowledge access')
      await Promise.all([load(), loadGrants(selected.id)])
    } catch (removeError) {
      setError(message(removeError))
    } finally {
      setBusy(false)
    }
  }

  async function addDefaultGroup() {
    if (!selected || !defaultGroupId || busy) return
    setBusy(true)
    setError(null)
    try {
      await overlayAppClient.knowledgeBases.setGroupDefault({
        groupId: defaultGroupId,
        knowledgeBaseId: selected.id,
      })
      setDefaultGroupId('')
      await Promise.all([load(), loadGrants(selected.id)])
    } catch (defaultError) {
      setError(message(defaultError))
    } finally {
      setBusy(false)
    }
  }

  async function removeDefaultGroup(groupId: string) {
    if (!selected || busy) return
    setBusy(true)
    setError(null)
    try {
      await overlayAppClient.knowledgeBases.removeGroupDefault({
        groupId,
        knowledgeBaseId: selected.id,
      })
      await load()
    } catch (defaultError) {
      setError(message(defaultError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section data-testid="admin-knowledge-bases">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><BookOpen size={17} /><h2 className="text-sm font-semibold">Knowledge bases</h2></div>
          <p className="mt-1 text-xs text-[var(--muted)]">Create organization brains and distribute access through users, groups, or roles.</p>
        </div>
        <p className="text-xs text-[var(--muted)]">{knowledgeBases.length} total</p>
      </div>

      {error ? <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      {canManage ? (
        <div className="mt-5 grid gap-2 border-y border-[var(--border)] py-4 lg:grid-cols-[minmax(180px,0.8fr)_minmax(240px,1.3fr)_auto]">
          <input aria-label="Knowledge base title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Organization knowledge base" className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" />
          <input aria-label="Knowledge base description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Purpose and audience" className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" />
          <Button variant="primary" onClick={() => void createOrganizationKnowledgeBase()} disabled={!title.trim() || busy}>
            {busy ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />} Create
          </Button>
        </div>
      ) : null}

      <div className="mt-5 grid min-h-[440px] gap-6 lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.4fr)]">
        <div className="min-w-0 border-r-0 border-[var(--border)] lg:border-r lg:pr-6">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-[var(--muted)]" size={14} />
            <input aria-label="Search knowledge bases" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search knowledge bases" className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 text-sm" />
          </div>
          <div className="mt-3 divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {filtered.length === 0 ? <p className="py-5 text-sm text-[var(--muted)]">No matching knowledge bases.</p> : filtered.map((base) => (
              <button key={base.id} type="button" onClick={() => setSelectedId(base.id)} className={`w-full px-2 py-3 text-left transition-colors ${selectedId === base.id ? 'bg-[var(--surface-subtle)]' : 'hover:bg-[var(--surface-subtle)]'}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{base.title}</p>
                  <span className="text-[10px] uppercase text-[var(--muted)]">{base.kind}</span>
                </div>
                <p className="mt-1 truncate text-xs text-[var(--muted)]">{ownerLabel(directory, base.ownerUserId)}</p>
                <p className="mt-1 text-[11px] text-[var(--muted)]">
                  {base.sourceCount} sources · {base.grantCount} grants · {base.defaultGroupCount} defaults
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          {!selected ? <p className="py-10 text-sm text-[var(--muted)]">Select a knowledge base to inspect access.</p> : (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold">{selected.title}</h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">Owned by {ownerLabel(directory, selected.ownerUserId)}</p>
                  {selected.description ? <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{selected.description}</p> : null}
                </div>
                <Link href={`/app/knowledge/${encodeURIComponent(selected.id)}`} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-[var(--border)]" aria-label="Open knowledge base">
                  <ExternalLink size={14} />
                </Link>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="border-y border-[var(--border)] py-3">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    <Activity size={14} /> Index health
                  </div>
                  <p className="mt-2 text-sm">
                    {selected.indexHealth.fresh} fresh
                    {selected.indexHealth.stale ? ` · ${selected.indexHealth.stale} stale` : ''}
                    {selected.indexHealth.failed ? ` · ${selected.indexHealth.failed} failed` : ''}
                    {selected.indexHealth.neverIndexed
                      ? ` · ${selected.indexHealth.neverIndexed} pending`
                      : ''}
                  </p>
                </div>
                <div className="border-y border-[var(--border)] py-3">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    <Database size={14} /> Indexed usage
                  </div>
                  <p className="mt-2 text-sm">
                    {selected.indexUsage.chunkCount.toLocaleString()} chunks ·{' '}
                    {selected.indexUsage.embeddedCount.toLocaleString()} embeddings
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {selected.indexUsage.indexedChars.toLocaleString()} indexed characters
                  </p>
                </div>
              </div>

              {canManage ? (
                <div className="mt-6 grid gap-2 sm:grid-cols-[100px_minmax(0,1fr)_100px_auto]">
                  <Select aria-label="Principal type" value={principalType} onChange={(event) => { setPrincipalType(event.target.value as AuthorizationPrincipalType); setPrincipalId('') }} className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs">
                    <option value="user">User</option><option value="group">Group</option><option value="role">Role</option>
                  </Select>
                  <Select aria-label="Knowledge access principal" value={principalId} onChange={(event) => setPrincipalId(event.target.value)} className="h-9 min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs">
                    <option value="">Select {principalType}</option>
                    {directoryEntries(directory, principalType).map((entry) => <option key={entry.id} value={entry.id}>{entryLabel(entry)}</option>)}
                  </Select>
                  <Select aria-label="Access role" value={accessRole} onChange={(event) => setAccessRole(event.target.value as typeof accessRole)} className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs">
                    <option value="viewer">Viewer</option><option value="editor">Editor</option>
                  </Select>
                  <IconButton aria-label="Add knowledge access" onClick={() => void addGrant()} disabled={!principalId || busy}><Plus size={14} /></IconButton>
                </div>
              ) : null}

              <div className="mt-6">
                <div className="flex items-center gap-2"><Users size={15} /><h4 className="text-xs font-semibold">Access</h4></div>
                <div className="mt-2 divide-y divide-[var(--border)] border-y border-[var(--border)]">
                  {grants.length === 0 ? <p className="py-5 text-sm text-[var(--muted)]">Only the owner currently has access.</p> : grants.map((grant) => (
                    <div key={grant.id} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{principalLabel(directory, grant)}</p><p className="text-xs text-[var(--muted)]">{grant.principalType} · {grant.accessRole}</p></div>
                      {canManage ? <IconButton aria-label="Remove knowledge access" onClick={() => void removeGrant(grant.id)} disabled={busy}><Trash2 size={14} /></IconButton> : null}
                    </div>
                  ))}
                </div>
              </div>

              {selected.kind === 'organization' ? (
                <div className="mt-6">
                  <div className="flex items-center gap-2">
                    <BookOpen size={15} />
                    <h4 className="text-xs font-semibold">Default for groups</h4>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Members use this base as fallback knowledge in otherwise unscoped chats.
                  </p>
                  {canManage ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <Select
                        aria-label="Default knowledge group"
                        value={defaultGroupId}
                        onChange={(event) => setDefaultGroupId(event.target.value)}
                        className="h-9 min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs"
                      >
                        <option value="">Select group</option>
                        {directory.groups
                          .filter(({ id }) => !selectedDefaults.some(({ groupId }) => groupId === id))
                          .map((group) => (
                            <option key={group.id} value={group.id}>{entryLabel(group)}</option>
                          ))}
                      </Select>
                      <Button
                        variant="secondary"
                        onClick={() => void addDefaultGroup()}
                        disabled={!defaultGroupId || busy}
                      >
                        <Plus size={14} /> Add default
                      </Button>
                    </div>
                  ) : null}
                  <div className="mt-2 divide-y divide-[var(--border)] border-y border-[var(--border)]">
                    {selectedDefaults.length === 0 ? (
                      <p className="py-4 text-sm text-[var(--muted)]">No group defaults.</p>
                    ) : selectedDefaults.map((value) => {
                      const group = directory.groups.find(({ id }) => id === value.groupId)
                      return (
                        <div key={`${value.groupId}:${value.knowledgeBaseId}`} className="flex items-center gap-3 py-3">
                          <p className="min-w-0 flex-1 truncate text-sm font-medium">
                            {group ? entryLabel(group) : value.groupId}
                          </p>
                          {canManage ? (
                            <IconButton
                              aria-label="Remove default knowledge group"
                              onClick={() => void removeDefaultGroup(value.groupId)}
                              disabled={busy}
                            >
                              <Trash2 size={14} />
                            </IconButton>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function directoryEntries(directory: KnowledgeBaseShareDirectoryResponse, type: AuthorizationPrincipalType) {
  if (type === 'user') return directory.users
  if (type === 'group') return directory.groups
  return directory.roles
}

function entryLabel(entry: KnowledgeBaseShareDirectoryResponse['users'][number]): string {
  if (entry.email && entry.name && entry.name !== entry.email) return `${entry.name} (${entry.email})`
  return entry.email || entry.name || entry.id
}

function principalLabel(directory: KnowledgeBaseShareDirectoryResponse, grant: ResourceGrant): string {
  const entry = directoryEntries(directory, grant.principalType).find(({ id }) => id === grant.principalId)
  return entry ? entryLabel(entry) : grant.principalId
}

function ownerLabel(directory: KnowledgeBaseShareDirectoryResponse, ownerUserId: string): string {
  const owner = directory.users.find(({ id }) => id === ownerUserId)
  return owner ? entryLabel(owner) : ownerUserId
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Knowledge administration request failed'
}
