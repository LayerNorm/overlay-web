'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import type { ProjectSummary } from '@overlay/app-core'
import { ProjectDetail } from '@overlay/modules-react/projects'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'
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

export function PublicShowcaseProjectsView() {
  const searchParams = useSearchParams()
  const { requireAuth } = useGuestGate()
  const selectedId = searchParams?.get('projectId') ?? projects[0]!._id
  const selected = useMemo(
    () => projects.find((project) => project._id === selectedId) ?? projects[0]!,
    [selectedId],
  )

  return (
    <AppScreenShell
      header={(
        <AppScreenHeader
          title="Projects"
          subtitle={selected.name}
          actions={<Button size="sm" onClick={() => requireAuth('nav')}>Open in Overlay</Button>}
        />
      )}
    >
      <AppScreenBody padding="none" maxWidth="none">
        <ProjectDetail
          project={selected}
          files={SHOWCASE_KNOWLEDGE_NODES.slice(0, 4)}
        />
      </AppScreenBody>
    </AppScreenShell>
  )
}
