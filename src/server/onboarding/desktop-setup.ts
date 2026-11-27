import 'server-only'

/**
 * A new account: setup has not started, and the only workspace is the personal one made for the person when they
 * first signed in. Overlay Desktop then runs its own first-run setup before the conversation.
 */
export async function isNewAccountForDesktopSetup(
  result: { completed: boolean; session: unknown },
  context: {
    auth: { userId: string }
    workspace: { workspace: { id: string; kind: string }; membership: { role: string } }
  },
  listForUser: (userId: string) => Promise<Array<{ workspace: { id: string; kind: string } }>>,
): Promise<boolean> {
  if (result.completed || result.session) return false
  if (context.workspace.workspace.kind !== 'personal' || context.workspace.membership.role !== 'owner') return false
  const accesses = await listForUser(context.auth.userId)
  return accesses.length === 1 && accesses[0]!.workspace.id === context.workspace.workspace.id
}
