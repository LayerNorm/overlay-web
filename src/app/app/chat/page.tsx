import { Suspense } from 'react'
import { ChatRouteClient } from '../_components/ClientSessionRoutes'
import { ChatRouteSkeleton } from '../_components/AppRouteSkeletons'

// No server I/O: the signed-in user comes from the app shell's AuthProvider,
// so client navigations to chat render immediately.
export default function ChatPage() {
  return (
    <Suspense fallback={<ChatRouteSkeleton />}>
      <ChatRouteClient />
    </Suspense>
  )
}
