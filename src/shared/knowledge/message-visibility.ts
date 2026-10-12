/**
 * Who may recall a chat message through search (`search_messages`, `search_knowledge`).
 *
 * A message chunk is indexed under its author. `owner` chunks surface only for that author; `workspace` chunks surface for
 * every active member of the workspace. Only a **public channel** is meant to be shared that widely. Personal chats and
 * direct messages are private to the people in them, and a private channel to its members, none of which a single
 * workspace flag can express, so they stay `owner` until search knows participants (docs/plans/TOOL_SCOPING_PLAN.md, T3):
 * safe over convenient, since a participant can still open the chat itself.
 *
 * Before this rule, every message in a conversation that had a workspace (every conversation does) was `workspace`, so a
 * teammate's search could return someone's personal chat or a DM they were not in.
 */
export type MessageChunkVisibility = 'owner' | 'workspace'

export function messageChunkVisibility(
  conversation: { conversationType?: string | null; channelVisibility?: string | null } | null | undefined,
): MessageChunkVisibility {
  if (!conversation) return 'owner'
  if (conversation.conversationType === 'channel' && conversation.channelVisibility === 'public') return 'workspace'
  return 'owner'
}

/**
 * Whether `viewerUserId` may see a message chunk written by `chunkUserId`: their own always, others' only when the
 * conversation it came from is shared as above. Checked again at retrieval so a chunk indexed under an older, looser rule
 * cannot leak while it waits to be backfilled.
 */
export function canRecallMessageChunk(args: {
  viewerUserId: string
  chunkUserId: string
  conversation: { conversationType?: string | null; channelVisibility?: string | null } | null | undefined
}): boolean {
  if (args.chunkUserId === args.viewerUserId) return true
  return messageChunkVisibility(args.conversation) === 'workspace'
}
