'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueries } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { api } from '../../convex/_generated/api'
import type { WorkspaceSummary } from '@/shared/workspaces/types'

const memberQuery = api.collaboration.nativeWorkspaces.listMemberKinds
type MemberPage = FunctionReturnType<typeof memberQuery>
type Cursors = Record<string, Array<string | null>>

function sameCursors(left: Cursors, right: Cursors) {
  return Object.keys(left).length === Object.keys(right).length
    && Object.entries(right).every(([id, values]) =>
      values.length === left[id]?.length
      && values.every((cursor, index) => cursor === left[id][index]))
}

export function NativeWorkspaceHeadcounts({
  workspaces,
  children,
}: {
  workspaces: readonly WorkspaceSummary[]
  children(workspaces: readonly WorkspaceSummary[]): ReactNode
}) {
  const [cursors, setCursors] = useState<Cursors>({})
  const requests = useMemo(() => Object.fromEntries(workspaces.flatMap(workspace =>
    (cursors[workspace.id] ?? [null]).map((cursor, index) => [
      `${workspace.id}:${index}`,
      {
        query: memberQuery,
        args: { workspaceId: workspace.id, paginationOpts: { cursor, numItems: 100 } },
      },
    ]))), [workspaces, cursors])
  const results = useQueries(requests)
  const nextCursors: Cursors = {}
  const counted = workspaces.map(workspace => {
    const knownCursors = cursors[workspace.id] ?? [null]
    const currentCursors: Array<string | null> = [null]
    nextCursors[workspace.id] = currentCursors
    let memberCount = 0
    let humanMemberCount = 0
    for (let index = 0; index < knownCursors.length; index += 1) {
      if (knownCursors[index] !== currentCursors[index]) break
      const result = results[`${workspace.id}:${index}`] as MemberPage | Error | undefined
      if (result instanceof Error) throw result
      if (!result) break
      for (const row of result.page) {
        memberCount += row.memberCount
        humanMemberCount += row.humanMemberCount
      }
      if (result.isDone) return { ...workspace, memberCount, humanMemberCount }
      currentCursors.push(result.continueCursor)
    }
    return workspace
  })
  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (!active) return
      setCursors(current => sameCursors(current, nextCursors) ? current : nextCursors)
    })
    return () => { active = false }
  })
  return children(counted)
}
