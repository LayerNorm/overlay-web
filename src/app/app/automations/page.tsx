import { Suspense } from 'react'
import { getOverlaySession } from '@/server/auth/session'
import ChatSuspenseBoundary from '@/features/chat/components/ChatSuspenseBoundary'
import { getOverlayCapabilitiesSync } from '@/server/capabilities'
import { ChatRouteSkeleton } from '../_components/AppRouteSkeletons'
import { AppScreenBody, AppScreenShell } from '@overlay/modules-react/shell'

function DisabledAutomationsRoute() {
  return (
    <AppScreenShell>
      <AppScreenBody padding="none" maxWidth="none" className="flex h-full items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold text-(--foreground)">Automations unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-(--muted)">
            Automations are disabled for this deployment.
          </p>
        </div>
      </AppScreenBody>
    </AppScreenShell>
  )
}

async function AutomationsRouteContent() {
  const session = await getOverlaySession()

  const userId = session?.user.id ?? null
  const firstName = session?.user.firstName ?? undefined
  return (
    <ChatSuspenseBoundary
      userId={userId}
      firstName={firstName}
      mode="automate"
    />
  )
}

export default function AutomationsPage() {
  const capabilities = getOverlayCapabilitiesSync()
  if (!capabilities.automations) return <DisabledAutomationsRoute />

  return (
    <Suspense fallback={<ChatRouteSkeleton mode="automate" />}>
      <AutomationsRouteContent />
    </Suspense>
  )
}
