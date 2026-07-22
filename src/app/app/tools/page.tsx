import dynamic from 'next/dynamic'
import { getOverlaySession } from '@/server/auth/session'
import { redirect } from 'next/navigation'
import { PublicShowcaseToolsView } from '@/features/showcase/PublicShowcaseToolsView'

const ToolsView = dynamic(() => import('@/features/tools/components/ToolsView'), {
  loading: () => <div className="flex min-h-[40vh] items-center justify-center text-sm text-[#888]">Loading...</div>,
})

export default async function ToolsPage({
  searchParams,
}: {
  searchParams?: Promise<{ showcase?: string | string[] }>
}) {
  const session = await getOverlaySession()
  const params = await searchParams
  const showcaseParam = Array.isArray(params?.showcase) ? params.showcase[0] : params?.showcase

  if (showcaseParam === '1') return <PublicShowcaseToolsView />
  if (!session) {
    redirect('/app/chat?signin=nav')
  }
  return <ToolsView userId={session.user.id} />
}
