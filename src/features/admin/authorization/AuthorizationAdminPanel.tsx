'use client'

import type {
  AuthorizationCapability,
  AuthorizationCapabilityDefinition,
  AuthorizationGroup,
  AuthorizationRole,
  GroupMembership,
  GroupRoleAssignment,
  UserRoleAssignment,
} from '@overlay/authz-contracts'
import { Archive, Check, Plus, RefreshCw, Shield, Trash2, UserPlus, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { authorizationDescription, groupCapabilityDefinitions, groupIsEditable, roleIsEditable } from './authorization-ui'

type AuthorizationView = 'roles' | 'groups'

export function AuthorizationAdminPanel({ view }: { view: AuthorizationView }) {
  const [capabilities, setCapabilities] = useState<AuthorizationCapabilityDefinition[]>([])
  const [roles, setRoles] = useState<AuthorizationRole[]>([])
  const [groups, setGroups] = useState<AuthorizationGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextCapabilities, nextRoles, nextGroups] = await Promise.all([
        overlayAppClient.adminAuthorization.listCapabilities({
          cache: 'no-store',
        }),
        overlayAppClient.adminAuthorization.listRoles({}, { cache: 'no-store' }),
        overlayAppClient.adminAuthorization.listGroups({}, { cache: 'no-store' }),
      ])
      setCapabilities(nextCapabilities)
      setRoles(nextRoles)
      setGroups(nextGroups)
      setForbidden(false)
    } catch (loadError) {
      if (isForbidden(loadError)) setForbidden(true)
      else setError(message(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (forbidden) {
    return <AccessDenied />
  }
  if (loading) {
    return <p className="py-12 text-sm text-[var(--muted)]">Loading authorization settings...</p>
  }

  return (
    <div data-testid={`admin-authorization-${view}`}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--muted)]">
          {view === 'roles' ? 'Define reusable capability sets and assign them to users.' : 'Organize users and assign roles to groups.'}
        </p>
        <button type="button" aria-label="Refresh authorization" className={iconButtonClass} onClick={() => void load()}>
          <RefreshCw size={15} />
        </button>
      </div>
      {error ? <ErrorMessage value={error} /> : null}
      {view === 'roles' ? (
        <RolesPanel capabilities={capabilities} roles={roles} onChanged={load} />
      ) : (
        <GroupsPanel groups={groups} roles={roles} onChanged={load} />
      )}
    </div>
  )
}

function RolesPanel({
  capabilities,
  roles,
  onChanged,
}: {
  capabilities: AuthorizationCapabilityDefinition[]
  roles: AuthorizationRole[]
  onChanged(): Promise<void>
}) {
  const [selectedId, setSelectedId] = useState<string | null>(roles[0]?.id ?? null)
  const [creating, setCreating] = useState(false)
  const selected = roles.find((role) => role.id === selectedId) ?? null
  const [name, setName] = useState(selected?.name ?? '')
  const [description, setDescription] = useState(selected?.description ?? '')
  const [selectedCapabilities, setSelectedCapabilities] = useState<AuthorizationCapability[]>(selected?.capabilities ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (creating) return
    setName(selected?.name ?? '')
    setDescription(selected?.description ?? '')
    setSelectedCapabilities(selected?.capabilities ?? [])
  }, [creating, selected])

  async function save() {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      if (creating) {
        await ensureOk(
          overlayAppClient.adminAuthorization.createRoleResponse({
            name: name.trim(),
            description: authorizationDescription(description),
            capabilities: selectedCapabilities,
          }),
          'Role creation failed',
        )
      } else if (selected) {
        await ensureOk(
          overlayAppClient.adminAuthorization.updateRoleResponse({
            roleId: selected.id,
            name: name.trim(),
            description: authorizationDescription(description),
            capabilities: selectedCapabilities,
          }),
          'Role update failed',
        )
      }
      setCreating(false)
      await onChanged()
    } catch (saveError) {
      setError(message(saveError))
    } finally {
      setBusy(false)
    }
  }

  async function archive() {
    if (!selected || !window.confirm(`Archive ${selected.name}?`)) return
    setBusy(true)
    setError(null)
    try {
      await ensureOk(overlayAppClient.adminAuthorization.archiveRoleResponse(selected.id), 'Role archive failed')
      setSelectedId(null)
      await onChanged()
    } catch (archiveError) {
      setError(message(archiveError))
    } finally {
      setBusy(false)
    }
  }

  function startCreate() {
    setCreating(true)
    setSelectedId(null)
    setName('')
    setDescription('')
    setSelectedCapabilities([])
    setError(null)
  }

  const editable = creating || roleIsEditable(selected)

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="border-r-0 border-[var(--border)] lg:border-r lg:pr-5">
        <button type="button" className={`${secondaryButtonClass} w-full justify-center`} onClick={startCreate}>
          <Plus size={15} /> New role
        </button>
        <div className="mt-4 divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {roles.map((role) => (
            <button
              type="button"
              key={role.id}
              className={`w-full px-2 py-3 text-left text-sm ${selected?.id === role.id && !creating ? 'bg-[var(--surface)]' : ''}`}
              onClick={() => {
                setCreating(false)
                setSelectedId(role.id)
                setError(null)
              }}
            >
              <span className="flex items-center justify-between gap-2 font-medium">
                {role.name}
                {role.isSystem ? <span className={badgeClass}>System</span> : null}
              </span>
              <span className="mt-1 block text-xs text-[var(--muted)]">{role.capabilities.length} capabilities</span>
            </button>
          ))}
          {roles.length === 0 ? <p className="px-2 py-4 text-sm text-[var(--muted)]">No roles yet.</p> : null}
        </div>
      </aside>

      <div>
        {creating || selected ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Shield size={17} />
                <h2 className="text-sm font-semibold">{creating ? 'New role' : selected?.name}</h2>
              </div>
              {!creating && selected && roleIsEditable(selected) ? (
                <button type="button" aria-label="Archive role" className={iconButtonClass} disabled={busy} onClick={() => void archive()}>
                  <Archive size={15} />
                </button>
              ) : null}
            </div>
            {selected?.isSystem ? <p className="mt-3 text-xs text-[var(--muted)]">System roles are managed by Overlay and cannot be changed.</p> : null}
            {error ? <ErrorMessage value={error} /> : null}
            <div className="mt-5 grid gap-3">
              <label className={labelClass}>
                Name
                <input className={inputClass} disabled={!editable} value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className={labelClass}>
                Description
                <textarea
                  className={`${inputClass} min-h-20 py-2`}
                  disabled={!editable}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
            </div>
            <CapabilityPicker definitions={capabilities} disabled={!editable} selected={selectedCapabilities} onChange={setSelectedCapabilities} />
            {editable ? (
              <button type="button" className={`${primaryButtonClass} mt-5`} disabled={busy || !name.trim()} onClick={() => void save()}>
                <Check size={15} /> Save role
              </button>
            ) : null}
            {!creating && selected ? <UserRoleAssignments role={selected} onChanged={onChanged} /> : null}
          </>
        ) : (
          <EmptyState icon={<Shield size={18} />} title="Select or create a role" />
        )}
      </div>
    </div>
  )
}

function CapabilityPicker({
  definitions,
  disabled,
  selected,
  onChange,
}: {
  definitions: AuthorizationCapabilityDefinition[]
  disabled: boolean
  selected: AuthorizationCapability[]
  onChange(value: AuthorizationCapability[]): void
}) {
  const sections = useMemo(() => groupCapabilityDefinitions(definitions), [definitions])
  const selectedSet = useMemo(() => new Set(selected), [selected])
  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold">Capabilities</h3>
      <div className="mt-3 grid gap-x-8 gap-y-5 md:grid-cols-2">
        {sections.map((section) => (
          <fieldset key={section.category} disabled={disabled}>
            <legend className="mb-2 text-xs font-medium text-[var(--muted)]">{section.label}</legend>
            <div className="space-y-2">
              {section.capabilities.map((capability) => (
                <label key={capability.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(capability.key)}
                    onChange={(event) => onChange(event.target.checked ? [...selected, capability.key] : selected.filter((value) => value !== capability.key))}
                  />
                  {capability.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </div>
  )
}

function UserRoleAssignments({ role, onChanged }: { role: AuthorizationRole; onChanged(): Promise<void> }) {
  const [userId, setUserId] = useState('')
  const [assignments, setAssignments] = useState<UserRoleAssignment[]>([])
  const [loadedUserId, setLoadedUserId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadAssignments(target = userId.trim()) {
    if (!target) return
    setError(null)
    try {
      const values = await overlayAppClient.adminAuthorization.listAssignments({
        subjectType: 'user',
        subjectId: target,
      })
      setAssignments(values as UserRoleAssignment[])
      setLoadedUserId(target)
    } catch (loadError) {
      setError(message(loadError))
    }
  }

  async function assign() {
    const target = userId.trim()
    if (!target) return
    setBusy(true)
    try {
      await ensureOk(
        overlayAppClient.adminAuthorization.assignRoleResponse({
          subjectType: 'user',
          subjectId: target,
          roleId: role.id,
        }),
        'Role assignment failed',
      )
      await loadAssignments(target)
      await onChanged()
    } catch (assignError) {
      setError(message(assignError))
    } finally {
      setBusy(false)
    }
  }

  async function revoke() {
    if (!loadedUserId) return
    setBusy(true)
    try {
      await ensureOk(
        overlayAppClient.adminAuthorization.revokeRoleResponse({
          subjectType: 'user',
          subjectId: loadedUserId,
          roleId: role.id,
        }),
        'Role revocation failed',
      )
      await loadAssignments(loadedUserId)
      await onChanged()
    } catch (revokeError) {
      setError(message(revokeError))
    } finally {
      setBusy(false)
    }
  }

  const assigned = assignments.some((assignment) => assignment.roleId === role.id)
  return (
    <section className="mt-8 border-t border-[var(--border)] pt-6">
      <h3 className="text-sm font-semibold">User assignment</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          aria-label="User ID for role assignment"
          className={`${inputClass} min-w-52 flex-1`}
          placeholder="User ID"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
        />
        <button type="button" className={secondaryButtonClass} onClick={() => void loadAssignments()} disabled={!userId.trim()}>
          Check
        </button>
        <button type="button" className={primaryButtonClass} onClick={() => void assign()} disabled={busy || !userId.trim() || assigned}>
          <UserPlus size={15} /> Assign
        </button>
      </div>
      {loadedUserId ? (
        <p className="mt-3 text-xs text-[var(--muted)]">
          {assigned ? 'Assigned' : 'Not assigned'} to {loadedUserId}
        </p>
      ) : null}
      {assigned ? (
        <button type="button" className={`${secondaryButtonClass} mt-3`} disabled={busy} onClick={() => void revoke()}>
          <Trash2 size={14} /> Revoke
        </button>
      ) : null}
      {error ? <ErrorMessage value={error} /> : null}
    </section>
  )
}

function GroupsPanel({ groups, roles, onChanged }: { groups: AuthorizationGroup[]; roles: AuthorizationRole[]; onChanged(): Promise<void> }) {
  const [selectedId, setSelectedId] = useState<string | null>(groups[0]?.id ?? null)
  const [creating, setCreating] = useState(false)
  const selected = groups.find((group) => group.id === selectedId) ?? null
  const [name, setName] = useState(selected?.name ?? '')
  const [description, setDescription] = useState(selected?.description ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (creating) return
    setName(selected?.name ?? '')
    setDescription(selected?.description ?? '')
  }, [creating, selected])

  async function save() {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      if (creating) {
        await ensureOk(
          overlayAppClient.adminAuthorization.createGroupResponse({
            name: name.trim(),
            description: authorizationDescription(description),
          }),
          'Group creation failed',
        )
      } else if (selected) {
        await ensureOk(
          overlayAppClient.adminAuthorization.updateGroupResponse({
            groupId: selected.id,
            name: name.trim(),
            description: authorizationDescription(description),
          }),
          'Group update failed',
        )
      }
      setCreating(false)
      await onChanged()
    } catch (saveError) {
      setError(message(saveError))
    } finally {
      setBusy(false)
    }
  }

  async function archive() {
    if (!selected || !window.confirm(`Archive ${selected.name}?`)) return
    setBusy(true)
    try {
      await ensureOk(overlayAppClient.adminAuthorization.archiveGroupResponse(selected.id), 'Group archive failed')
      setSelectedId(null)
      await onChanged()
    } catch (archiveError) {
      setError(message(archiveError))
    } finally {
      setBusy(false)
    }
  }

  const editable = creating || groupIsEditable(selected)
  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="border-r-0 border-[var(--border)] lg:border-r lg:pr-5">
        <button
          type="button"
          className={`${secondaryButtonClass} w-full justify-center`}
          onClick={() => {
            setCreating(true)
            setSelectedId(null)
            setName('')
            setDescription('')
            setError(null)
          }}
        >
          <Plus size={15} /> New group
        </button>
        <div className="mt-4 divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {groups.map((group) => (
            <button
              type="button"
              key={group.id}
              className={`w-full px-2 py-3 text-left text-sm ${selected?.id === group.id && !creating ? 'bg-[var(--surface)]' : ''}`}
              onClick={() => {
                setCreating(false)
                setSelectedId(group.id)
                setError(null)
              }}
            >
              <span className="flex items-center justify-between gap-2 font-medium">
                {group.name}
                <span className={badgeClass}>{group.source}</span>
              </span>
              {group.description ? <span className="mt-1 block truncate text-xs text-[var(--muted)]">{group.description}</span> : null}
            </button>
          ))}
          {groups.length === 0 ? <p className="px-2 py-4 text-sm text-[var(--muted)]">No groups yet.</p> : null}
        </div>
      </aside>
      <div>
        {creating || selected ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Users size={17} />
                <h2 className="text-sm font-semibold">{creating ? 'New group' : selected?.name}</h2>
              </div>
              {!creating && selected && groupIsEditable(selected) ? (
                <button type="button" aria-label="Archive group" className={iconButtonClass} disabled={busy} onClick={() => void archive()}>
                  <Archive size={15} />
                </button>
              ) : null}
            </div>
            {selected?.source === 'external' ? (
              <p className="mt-3 text-xs text-[var(--muted)]">This group is synchronized by an external identity provider and is read-only.</p>
            ) : null}
            {error ? <ErrorMessage value={error} /> : null}
            <div className="mt-5 grid gap-3">
              <label className={labelClass}>
                Name
                <input className={inputClass} disabled={!editable} value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className={labelClass}>
                Description
                <textarea
                  className={`${inputClass} min-h-20 py-2`}
                  disabled={!editable}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
            </div>
            {editable ? (
              <button type="button" className={`${primaryButtonClass} mt-5`} disabled={busy || !name.trim()} onClick={() => void save()}>
                <Check size={15} /> Save group
              </button>
            ) : null}
            {!creating && selected ? <GroupAccess group={selected} roles={roles} editable={groupIsEditable(selected)} /> : null}
          </>
        ) : (
          <EmptyState icon={<Users size={18} />} title="Select or create a group" />
        )}
      </div>
    </div>
  )
}

function GroupAccess({ group, roles, editable }: { group: AuthorizationGroup; roles: AuthorizationRole[]; editable: boolean }) {
  const [memberships, setMemberships] = useState<GroupMembership[]>([])
  const [assignments, setAssignments] = useState<GroupRoleAssignment[]>([])
  const [userId, setUserId] = useState('')
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [nextMemberships, nextAssignments] = await Promise.all([
        overlayAppClient.adminAuthorization.listMemberships(group.id),
        overlayAppClient.adminAuthorization.listAssignments({
          subjectType: 'group',
          subjectId: group.id,
        }),
      ])
      setMemberships(nextMemberships)
      setAssignments(nextAssignments as GroupRoleAssignment[])
      setError(null)
    } catch (loadError) {
      setError(message(loadError))
    }
  }, [group.id])

  useEffect(() => {
    void load()
  }, [load])

  async function mutate(operation: Promise<Response>, fallback: string) {
    setBusy(true)
    try {
      await ensureOk(operation, fallback)
      await load()
    } catch (mutationError) {
      setError(message(mutationError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-8 grid gap-8 border-t border-[var(--border)] pt-6 md:grid-cols-2">
      <section>
        <h3 className="text-sm font-semibold">Members</h3>
        {editable ? (
          <div className="mt-3 flex gap-2">
            <input
              aria-label="Group member user ID"
              className={`${inputClass} min-w-0 flex-1`}
              placeholder="User ID"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            />
            <button
              type="button"
              aria-label="Add group member"
              className={iconButtonClass}
              disabled={busy || !userId.trim()}
              onClick={() => {
                void mutate(
                  overlayAppClient.adminAuthorization.addMembershipResponse({
                    groupId: group.id,
                    userId: userId.trim(),
                  }),
                  'Adding member failed',
                )
                setUserId('')
              }}
            >
              <UserPlus size={15} />
            </button>
          </div>
        ) : null}
        <div className="mt-3 divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {memberships.map((membership) => (
            <div key={membership.userId} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 truncate">{membership.userId}</span>
              {editable && membership.source === 'local' ? (
                <button
                  type="button"
                  aria-label={`Remove ${membership.userId}`}
                  className="text-[var(--muted)]"
                  onClick={() =>
                    void mutate(
                      overlayAppClient.adminAuthorization.removeMembershipResponse({ groupId: group.id, userId: membership.userId }),
                      'Removing member failed',
                    )
                  }
                >
                  <Trash2 size={14} />
                </button>
              ) : (
                <span className={badgeClass}>{membership.source}</span>
              )}
            </div>
          ))}
          {memberships.length === 0 ? <p className="py-3 text-sm text-[var(--muted)]">No members.</p> : null}
        </div>
      </section>
      <section>
        <h3 className="text-sm font-semibold">Assigned roles</h3>
        {editable ? (
          <div className="mt-3 flex gap-2">
            <select
              aria-label="Role to assign to group"
              className={`${inputClass} min-w-0 flex-1`}
              value={roleId}
              onChange={(event) => setRoleId(event.target.value)}
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label="Assign role to group"
              className={iconButtonClass}
              disabled={busy || !roleId || assignments.some((assignment) => assignment.roleId === roleId)}
              onClick={() =>
                void mutate(
                  overlayAppClient.adminAuthorization.assignRoleResponse({
                    subjectType: 'group',
                    subjectId: group.id,
                    roleId,
                  }),
                  'Assigning role failed',
                )
              }
            >
              <Plus size={15} />
            </button>
          </div>
        ) : null}
        <div className="mt-3 divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {assignments.map((assignment) => (
            <div key={assignment.roleId} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span>{roles.find((role) => role.id === assignment.roleId)?.name ?? assignment.roleId}</span>
              {editable ? (
                <button
                  type="button"
                  aria-label="Revoke group role"
                  className="text-[var(--muted)]"
                  onClick={() =>
                    void mutate(
                      overlayAppClient.adminAuthorization.revokeRoleResponse({
                        subjectType: 'group',
                        subjectId: group.id,
                        roleId: assignment.roleId,
                      }),
                      'Revoking role failed',
                    )
                  }
                >
                  <Trash2 size={14} />
                </button>
              ) : null}
            </div>
          ))}
          {assignments.length === 0 ? <p className="py-3 text-sm text-[var(--muted)]">No assigned roles.</p> : null}
        </div>
      </section>
      {error ? (
        <div className="md:col-span-2">
          <ErrorMessage value={error} />
        </div>
      ) : null}
    </div>
  )
}

function EmptyState({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 border-y border-[var(--border)] text-sm text-[var(--muted)]">
      {icon}
      <p>{title}</p>
    </div>
  )
}

function AccessDenied() {
  return (
    <div className="py-12" data-testid="authorization-forbidden">
      <Shield size={20} />
      <h2 className="mt-3 text-base font-semibold">Role administration access required</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">Your account cannot manage roles or groups.</p>
    </div>
  )
}

function ErrorMessage({ value }: { value: string }) {
  return (
    <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
      {value}
    </p>
  )
}

async function ensureOk(responsePromise: Promise<Response>, fallback: string): Promise<void> {
  const response = await responsePromise
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string
  }
  if (!response.ok)
    throw Object.assign(new Error(payload.error || fallback), {
      status: response.status,
    })
}

function isForbidden(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'status' in error && error.status === 403)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Authorization request failed'
}

const inputClass = 'mt-1 h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60'
const labelClass = 'text-xs font-medium text-[var(--muted)]'
const primaryButtonClass =
  'inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--foreground)] px-4 text-sm font-medium text-[var(--background)] disabled:opacity-50'
const secondaryButtonClass = 'inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border)] px-3 text-sm disabled:opacity-50'
const iconButtonClass = 'inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-[var(--border)] disabled:opacity-50'
const badgeClass = 'inline-flex rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-medium uppercase text-[var(--muted)]'
