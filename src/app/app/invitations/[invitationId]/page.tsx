import { AcceptWorkspaceInvitation } from '@/features/workspaces/components/invitations/AcceptWorkspaceInvitation'

export default async function WorkspaceInvitationPage({
  params,
}: {
  params: Promise<{ invitationId: string }>
}) {
  const { invitationId } = await params
  return <AcceptWorkspaceInvitation invitationId={invitationId} />
}
