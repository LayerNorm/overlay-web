import assert from 'node:assert/strict'
import test from 'node:test'
import type { OptimisticLocalStore } from 'convex/browser'
import { getFunctionName, type FunctionReturnType } from 'convex/server'
import type { Id } from '../../../../convex/_generated/dataModel'
import { api } from '../../../../convex/_generated/api'
import { optimisticallyChangeSkill } from './native-skills-optimistic'

type Detail = NonNullable<FunctionReturnType<typeof api.integrations.nativeSkills.get>>
type ListResult = FunctionReturnType<typeof api.integrations.nativeSkills.list>
type AvailabilityResult = FunctionReturnType<typeof api.integrations.nativeSkills.availability>
type QueryRef =
  | typeof api.integrations.nativeSkills.get
  | typeof api.integrations.nativeSkills.list
  | typeof api.integrations.nativeSkills.availability
type Entry = { args: Record<string, unknown>; value: unknown }

function makeStore() {
  const entries = new Map<string, Entry[]>()
  const keyFor = (query: QueryRef) => getFunctionName(query)
  const store = {
    getAllQueries: (query: QueryRef) => entries.get(keyFor(query)) ?? [],
    setQuery: (query: QueryRef, args: Record<string, unknown>, value: unknown) => {
      const queryKey = keyFor(query)
      const current = entries.get(queryKey) ?? []
      const argsKey = JSON.stringify(args)
      const index = current.findIndex(entry => JSON.stringify(entry.args) === argsKey)
      const next = [...current]
      if (index < 0) next.push({ args, value })
      else next[index] = { args, value }
      entries.set(queryKey, next)
    },
  } as unknown as OptimisticLocalStore
  return {
    store,
    put(query: QueryRef, args: Record<string, unknown>, value: unknown) {
      const key = keyFor(query)
      const current = entries.get(key) ?? []
      entries.set(key, [...current.filter(entry => JSON.stringify(entry.args) !== JSON.stringify(args)), { args, value }])
    },
    get(query: QueryRef, args: Record<string, unknown>) {
      return entries.get(keyFor(query))?.find(entry => JSON.stringify(entry.args) === JSON.stringify(args))?.value
    },
  }
}

function detail(id: string, revision: number, values: Partial<Detail> = {}): Detail {
  return {
    _id: id as Id<'skills'>,
    userId: 'alice',
    workspaceId: 'workspace-a',
    name: `Skill ${id}`,
    description: `Description ${id}`,
    instructions: `Private instructions ${id}`,
    enabled: true,
    scope: 'personal',
    createdAt: 1,
    updatedAt: 1,
    revision,
    editable: true,
    options: { moveTo: 'workspace', canArchive: true, canRestore: false },
    ...values,
  }
}

function summary(id: string, revision: number, values: Partial<ListResult['page'][number]> = {}): ListResult['page'][number] {
  const current = detail(id, revision, values as Partial<Detail>)
  const { instructions, ...row } = current
  void instructions
  return row
}

function availability(id: string, revision: number): AvailabilityResult['page'][number] {
  return { _id: id as Id<'skills'>, name: `Skill ${id}`, description: `Description ${id}`, enabled: true, revision }
}

const getArgs = (workspaceId: string, skillId: string) => ({ workspaceId, skillId: skillId as Id<'skills'> })
const listArgs = (workspaceId: string, view: 'personal' | 'workspace' | 'archived') => ({
  workspaceId, view, paginationOpts: { numItems: 25, cursor: null },
})
const availabilityArgs = (workspaceId: string, legacyPersonal = false) => ({
  workspaceId, workspaceOnly: false, legacyPersonal, paginationOpts: { numItems: 25, cursor: null },
})

test('entity patches are workspace-scoped and preserve unrelated list rows', () => {
  const local = makeStore()
  const skillId = 'skill-a'
  const otherId = 'skill-b'
  local.put(api.integrations.nativeSkills.get, getArgs('workspace-a', skillId), detail(skillId, 4))
  local.put(api.integrations.nativeSkills.get, getArgs('workspace-b', skillId), detail(skillId, 4, { workspaceId: 'workspace-b' }))
  local.put(api.integrations.nativeSkills.list, listArgs('workspace-a', 'personal'), {
    page: [summary(skillId, 4), summary(otherId, 9)],
    continueCursor: 'next',
    isDone: false,
  } satisfies ListResult)
  local.put(api.integrations.nativeSkills.list, listArgs('workspace-b', 'personal'), {
    page: [summary(skillId, 4, { workspaceId: 'workspace-b' })],
    continueCursor: null,
    isDone: true,
  } satisfies ListResult)
  local.put(api.integrations.nativeSkills.availability, availabilityArgs('workspace-a'), {
    page: [availability(skillId, 4), availability(otherId, 9)],
    continueCursor: null,
    isDone: true,
  } satisfies AvailabilityResult)
  local.put(api.integrations.nativeSkills.availability, availabilityArgs('workspace-a', true), {
    page: [availability(skillId, 4)],
    continueCursor: null,
    isDone: true,
  } satisfies AvailabilityResult)

  optimisticallyChangeSkill(local.store, { workspaceId: 'workspace-a', skillId, expectedRevision: 4 }, { name: 'Local edit' })

  assert.equal((local.get(api.integrations.nativeSkills.get, getArgs('workspace-a', skillId)) as Detail).name, 'Local edit')
  assert.equal((local.get(api.integrations.nativeSkills.get, getArgs('workspace-b', skillId)) as Detail).name, `Skill ${skillId}`)
  const page = local.get(api.integrations.nativeSkills.list, listArgs('workspace-a', 'personal')) as ListResult
  assert.equal(page.page[0]?.name, 'Local edit')
  assert.equal(page.page[1]?.name, `Skill ${otherId}`)
  assert.equal((local.get(api.integrations.nativeSkills.availability, availabilityArgs('workspace-a')) as AvailabilityResult).page[0]?.name, 'Local edit')
  assert.equal((local.get(api.integrations.nativeSkills.availability, availabilityArgs('workspace-a', true)) as AvailabilityResult).page[0]?.name, `Skill ${skillId}`)
})

test('a newer server revision is not overwritten by a stale optimistic draft', () => {
  const local = makeStore()
  const skillId = 'skill-a'
  local.put(api.integrations.nativeSkills.get, getArgs('workspace-a', skillId), detail(skillId, 7, { name: 'Server baseline' }))
  local.put(api.integrations.nativeSkills.list, listArgs('workspace-a', 'personal'), {
    page: [summary(skillId, 7, { name: 'Server baseline' })],
    continueCursor: null,
    isDone: true,
  } satisfies ListResult)
  local.put(api.integrations.nativeSkills.availability, availabilityArgs('workspace-a'), {
    page: [availability(skillId, 7)],
    continueCursor: null,
    isDone: true,
  } satisfies AvailabilityResult)

  optimisticallyChangeSkill(local.store, { workspaceId: 'workspace-a', skillId, expectedRevision: 6 }, { name: 'Stale draft' })

  assert.equal((local.get(api.integrations.nativeSkills.get, getArgs('workspace-a', skillId)) as Detail).name, 'Server baseline')
  assert.equal((local.get(api.integrations.nativeSkills.list, listArgs('workspace-a', 'personal')) as ListResult).page[0]?.name, 'Server baseline')
  assert.deepEqual((local.get(api.integrations.nativeSkills.availability, availabilityArgs('workspace-a')) as AvailabilityResult).page[0], availability(skillId, 7))
})

test('archive and delete optimistically remove skills from active availability', () => {
  const local = makeStore()
  const skillId = 'skill-a'
  local.put(api.integrations.nativeSkills.get, getArgs('workspace-a', skillId), detail(skillId, 2))
  local.put(api.integrations.nativeSkills.list, listArgs('workspace-a', 'personal'), {
    page: [summary(skillId, 2)],
    continueCursor: null,
    isDone: true,
  } satisfies ListResult)
  local.put(api.integrations.nativeSkills.availability, availabilityArgs('workspace-a'), {
    page: [availability(skillId, 2)],
    continueCursor: null,
    isDone: true,
  } satisfies AvailabilityResult)

  optimisticallyChangeSkill(local.store, { workspaceId: 'workspace-a', skillId, expectedRevision: 2 }, { archivedAt: 10 })
  assert.deepEqual((local.get(api.integrations.nativeSkills.list, listArgs('workspace-a', 'personal')) as ListResult).page, [])
  assert.deepEqual((local.get(api.integrations.nativeSkills.availability, availabilityArgs('workspace-a')) as AvailabilityResult).page, [])
  assert.equal((local.get(api.integrations.nativeSkills.get, getArgs('workspace-a', skillId)) as Detail).archivedAt, 10)

  local.put(api.integrations.nativeSkills.list, listArgs('workspace-a', 'archived'), {
    page: [summary(skillId, 3, { archivedAt: 10, archivedFromScope: 'personal' })],
    continueCursor: null,
    isDone: true,
  } satisfies ListResult)
  optimisticallyChangeSkill(local.store, { workspaceId: 'workspace-a', skillId, expectedRevision: 3 }, null)
  assert.equal(local.get(api.integrations.nativeSkills.get, getArgs('workspace-a', skillId)), null)
  assert.deepEqual((local.get(api.integrations.nativeSkills.list, listArgs('workspace-a', 'archived')) as ListResult).page, [])
})

test('reapplying an optimistic update over a newer server snapshot preserves it on rebase and rollback', () => {
  const local = makeStore()
  const skillId = 'skill-a'
  const args = { workspaceId: 'workspace-a', skillId, expectedRevision: 5 }
  const detailKey = getArgs('workspace-a', skillId)
  local.put(api.integrations.nativeSkills.get, detailKey, detail(skillId, 5, { name: 'Before' }))

  optimisticallyChangeSkill(local.store, args, { name: 'Optimistic edit' })
  assert.equal((local.get(api.integrations.nativeSkills.get, detailKey) as Detail).name, 'Optimistic edit')

  const serverSnapshot = detail(skillId, 6, { name: 'Concurrent server edit' })
  local.put(api.integrations.nativeSkills.get, detailKey, serverSnapshot)
  optimisticallyChangeSkill(local.store, args, { name: 'Optimistic edit' })
  assert.equal((local.get(api.integrations.nativeSkills.get, detailKey) as Detail).name, 'Concurrent server edit')

  local.put(api.integrations.nativeSkills.get, detailKey, serverSnapshot)
  assert.equal((local.get(api.integrations.nativeSkills.get, detailKey) as Detail).name, 'Concurrent server edit')
})
