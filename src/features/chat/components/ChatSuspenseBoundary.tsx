import { Suspense, type ReactNode } from 'react'
import ChatExperience from './ChatExperience'
import { ConversationExperienceRouter } from './ConversationExperienceRouter'
import { ChatRouteSkeleton } from './ChatSkeletons'

type ChatInterfaceProps = {
  userId: string | null
  firstName?: string
  hideSidebar?: boolean
  projectName?: string
  mode?: 'chat' | 'automate'
  hideHeader?: boolean
  belowEmptyComposer?: ReactNode
}

export default function ChatSuspenseBoundary(props: ChatInterfaceProps) {
  return (
    <Suspense fallback={<ChatRouteSkeleton hideHeader={props.hideHeader} mode={props.mode} />}>
      {props.mode === 'automate' || props.hideSidebar ? (
        <ChatExperience {...props} />
      ) : (
        <ConversationExperienceRouter {...props} />
      )}
    </Suspense>
  )
}
