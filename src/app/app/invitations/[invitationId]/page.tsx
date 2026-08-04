import { AcceptWorkspaceInvitation } from '@/features/workspaces/components/invitations/AcceptWorkspaceInvitation'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function WorkspaceInvitationPage({
  params,
}: {
  params: Promise<{ invitationId: string }>
}) {
  const { invitationId } = await params
  return <AcceptWorkspaceInvitation invitationId={invitationId} />
}
