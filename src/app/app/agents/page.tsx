import { AgentsDirectory } from '@/features/agents/components/AgentsDirectory'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function AgentsPage({
  searchParams,
}: {
  searchParams?: Promise<{ showcase?: string | string[] }>
}) {
  const params = await searchParams
  const showcase = Array.isArray(params?.showcase) ? params.showcase[0] === '1' : params?.showcase === '1'
  return <AgentsDirectory showcase={showcase} />
}
