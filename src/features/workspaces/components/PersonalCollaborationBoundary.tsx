'use client'

import { UsersRound } from 'lucide-react'
import { Button, EmptyState } from '@overlay/ui/primitives'
import { requestCreateWorkspace } from '@/shared/workspaces/personal-workspace-boundary'

export function PersonalCollaborationBoundary({
  className = 'min-h-72 px-6 py-12',
}: {
  className?: string
}) {
  return (
    <EmptyState
      className={className}
      icon={<UsersRound size={28} strokeWidth={1.5} />}
      title="Personal is private"
      description="Create a workspace when you want to invite people, use channels, or share resources with a team."
      action={(
        <Button size="sm" onClick={requestCreateWorkspace}>
          Create workspace
        </Button>
      )}
    />
  )
}
