import { Suspense } from 'react'
import { getOverlaySession } from '@/server/auth/session'
import ChatSuspenseBoundary from '@/features/chat/components/ChatSuspenseBoundary'
import { getInitialChatHistory } from '@/server/app/route-data'
import { getOverlayCapabilitiesSync } from '@/server/capabilities'
import { ChatRouteSkeleton } from '../_components/AppRouteSkeletons'
import { AppScreenBody, AppScreenShell } from '@overlay/modules-react/shell'
import { PublicShowcaseAutomationsView } from '@/features/showcase/PublicShowcaseAutomationsView'

function DisabledAutomationsRoute() {
  return (
    <AppScreenShell>
      <AppScreenBody padding="none" maxWidth="none" className="flex h-full items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-[var(--foreground)]">Automations unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Automations are disabled for this deployment.
        </p>
      </div>
      </AppScreenBody>
    </AppScreenShell>
  )
}

async function AutomationsRouteContent({
  userId,
  firstName,
}: {
  userId: string | null
  firstName?: string
}) {
  const initialChatPage = userId
    ? await getInitialChatHistory()
    : { data: [], hasMore: false }
  return (
    <ChatSuspenseBoundary
      userId={userId}
      firstName={firstName}
      mode="automate"
      initialChats={initialChatPage?.data}
      initialChatPageInfo={initialChatPage ? {
        nextCursor: initialChatPage.nextCursor,
        hasMore: initialChatPage.hasMore,
      } : undefined}
    />
  )
}

export default async function AutomationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ showcase?: string | string[] }>
}) {
  const capabilities = getOverlayCapabilitiesSync()
  const session = await getOverlaySession()
  const params = await searchParams
  const showcaseParam = Array.isArray(params?.showcase) ? params.showcase[0] : params?.showcase

  if (showcaseParam === '1') return <PublicShowcaseAutomationsView />

  if (!capabilities.automations) return <DisabledAutomationsRoute />

  return (
    <Suspense fallback={<ChatRouteSkeleton mode="automate" />}>
      <AutomationsRouteContent
        userId={session?.user.id ?? null}
        firstName={session?.user.firstName ?? undefined}
      />
    </Suspense>
  )
}
