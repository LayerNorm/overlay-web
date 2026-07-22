'use client'

import { useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ProjectSummary } from '@overlay/app-core'
import type { TreeNode } from '@overlay/app-core/modules'
import { ProjectDetail, ProjectsModuleShell } from '@overlay/modules-react/projects'
import { Button } from '@overlay/ui'
import { useGuestGate } from '@/components/providers/GuestGateProvider'
import {
  SHOWCASE_KNOWLEDGE_NODES,
  SHOWCASE_PROJECTS,
} from './showcase-data'

const timestamp = Date.parse('2026-07-22T18:00:00.000Z')

const projects: ProjectSummary[] = SHOWCASE_PROJECTS.map((project, index) => ({
  _id: `showcase-${project.id}`,
  name: project.name,
  description: project.description,
  instructions: project.description,
  parentId: null,
  createdAt: timestamp - index * 60_000,
  updatedAt: timestamp - index * 60_000,
}))

const tree: TreeNode<ProjectSummary>[] = projects.map((project) => ({
  item: project,
  depth: 0,
  children: [],
}))

export function PublicShowcaseProjectsView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { requireAuth } = useGuestGate()
  const selectedId = searchParams?.get('projectId') ?? projects[0]!._id
  const selected = useMemo(
    () => projects.find((project) => project._id === selectedId) ?? projects[0]!,
    [selectedId],
  )

  return (
    <ProjectsModuleShell
      projects={tree}
      selectedProjectId={selected._id}
      onSelectProject={(project) => {
        router.push(`/app/projects?${new URLSearchParams({ showcase: '1', projectId: project._id }).toString()}`)
      }}
      onCreateProject={() => requireAuth('nav')}
      detail={(
        <ProjectDetail
          project={selected}
          files={SHOWCASE_KNOWLEDGE_NODES.slice(0, 4)}
          actions={<Button size="sm" onClick={() => requireAuth('nav')}>Open in Overlay</Button>}
        />
      )}
    />
  )
}
