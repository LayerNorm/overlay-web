import { notFound, redirect } from 'next/navigation'
import type { ShowcaseSurface } from '@/features/showcase/showcase-data'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

const SURFACES = new Set<ShowcaseSurface>(['chat', 'files', 'projects', 'automations', 'extensions'])

export default async function ShowcaseSurfacePage({ params }: { params: Promise<{ surface: string }> }) {
  const { surface } = await params
  if (!SURFACES.has(surface as ShowcaseSurface)) notFound()
  const destinations: Record<ShowcaseSurface, string> = {
    chat: '/app/chat?showcase=1&id=showcase-welcome',
    files: '/app/files?showcase=1',
    projects: '/app/projects?showcase=1',
    automations: '/app/automations?showcase=1',
    extensions: '/app/tools?showcase=1',
  }
  redirect(destinations[surface as ShowcaseSurface])
}
