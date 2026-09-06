import { AgentEditorPage } from '@/features/agents/components/AgentEditorPage'

export default async function EditAgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>
  searchParams?: Promise<{ showcase?: string | string[] }>
}) {
  const [{ agentId }, query] = await Promise.all([params, searchParams])
  const showcase = Array.isArray(query?.showcase) ? query?.showcase[0] === '1' : query?.showcase === '1'
  return <AgentEditorPage mode="edit" agentId={agentId} showcase={showcase} />
}
