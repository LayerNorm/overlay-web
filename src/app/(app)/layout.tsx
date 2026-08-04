import { AppClientProviders } from '@/components/providers/AppClientProviders'
import { getOverlaySession } from '@/server/auth/session'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getOverlaySession()
  return <AppClientProviders initialUser={session?.user ?? null}>{children}</AppClientProviders>
}
