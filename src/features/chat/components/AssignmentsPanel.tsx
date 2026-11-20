'use client'

import { GitBranch } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import { roomMessageDomId, scrollRoomMessageIntoView } from './collaboration/room-message-view'
import { roomMessageTime } from './collaboration/room-message-time'
import { AssignmentRow, assignmentSummary, type AssignmentNavigationItem } from './AgentAssignments'
import { useConversationAssignments } from './AgentAssignmentSubscription'

function showInConversation(messageId: string) {
  const element = document.getElementById(roomMessageDomId(messageId))
  if (element) scrollRoomMessageIntoView(element)
}

function AssignmentGroup({ label, messageId, items }: { label: string; messageId?: string; items: AssignmentNavigationItem[] }) {
  return (
    <section className="min-w-0">
      <div className="flex h-7 items-center justify-between gap-2 px-3">
        <h3 className="truncate text-xs text-(--muted)">{label}</h3>
        {messageId ? (
          <Button variant="ghost" size="xs" type="button" onClick={() => showInConversation(messageId)}
            className="h-6 shrink-0 px-1.5 text-[11px] font-normal text-(--muted) hover:text-(--foreground)">
            Show in conversation
          </Button>
        ) : null}
      </div>
      <ul>{items.map(item => <AssignmentRow key={item.assignmentId} item={item} />)}</ul>
    </section>
  )
}

/** Every assignment in the conversation, grouped by the response that made it. */
export function AssignmentsPanel() {
  const loaded = useConversationAssignments()
  if (!loaded || loaded.assignments.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 py-16 text-center">
        <GitBranch className="size-5 text-(--muted-light)" strokeWidth={1.75} aria-hidden />
        <p className="text-sm text-(--foreground)">{loaded ? 'No assignments yet' : 'Loading assignments'}</p>
        {loaded ? <p className="text-xs text-(--muted)">Work handed to other agents in this conversation shows up here.</p> : null}
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-4 px-2 pb-6 pt-3">
      <p className="px-3 text-xs text-(--muted)">{assignmentSummary(loaded.assignments)}</p>
      {[...loaded.byMessage].map(([messageId, items]) => (
        <AssignmentGroup key={messageId} messageId={messageId} items={items}
          label={items[0]?.createdAt ? `Assigned ${roomMessageTime(items[0].createdAt)}` : 'Assigned'} />
      ))}
      {loaded.unanchored.length ? <AssignmentGroup label="Earlier" items={loaded.unanchored} /> : null}
    </div>
  )
}

export function useAssignmentCount(): number | undefined {
  return useConversationAssignments()?.assignments.length
}
