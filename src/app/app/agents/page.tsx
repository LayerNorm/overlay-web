import { AgentsDirectory } from '@/features/agents/components/AgentsDirectory'

export default async function AgentsPage({
  searchParams,
}: {
  searchParams?: Promise<{ showcase?: string | string[] }>
}) {
  const params = await searchParams
  const showcase = Array.isArray(params?.showcase) ? params.showcase[0] === '1' : params?.showcase === '1'
  return <AgentsDirectory showcase={showcase} />
}
