import { AgentEditorPage } from '@/features/agents/components/AgentEditorPage'

export default async function NewAgentPage({
  searchParams,
}: {
  searchParams?: Promise<{ showcase?: string | string[] }>
}) {
  const params = await searchParams
  const showcase = Array.isArray(params?.showcase) ? params?.showcase[0] === '1' : params?.showcase === '1'
  return <AgentEditorPage mode="new" showcase={showcase} />
}
