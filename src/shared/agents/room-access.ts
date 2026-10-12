/**
 * The room rule (docs/plans/TOOL_SCOPING_PLAN.md, T4): an agent that answers in a room others can read must not bring the
 * summoner's private material into it. Its reply is visible to everyone in the room, so a personal memory, personal
 * file, or personal skill the summoner can see must not be loaded for it automatically.
 *
 * A room is shared when more than one person is in it, or when it is a channel anyone in the workspace can read (a public
 * channel keeps its history for whoever joins later). A chat between one person and an agent, and a private channel with
 * one person in it, are not shared.
 */
export function isSharedRoom(args: {
  conversationType: 'personal' | 'dm' | 'channel'
  channelVisibility?: string | null
  humanParticipants: number
}): boolean {
  if (args.humanParticipants > 1) return true
  return args.conversationType === 'channel' && args.channelVisibility !== 'private'
}

/** What an agent may load for the summoner before answering, given the room it is in. */
export function roomContextAccess(shared: boolean): {
  /** The summoner's own memories and memory profile. */
  personalMemory: boolean
  /** Automatic retrieval over the summoner's files, notes, and memories. */
  personalRetrieval: boolean
  /** The summoner's personal skills (skills shared with the workspace are always offered). */
  personalSkills: boolean
} {
  return { personalMemory: !shared, personalRetrieval: !shared, personalSkills: !shared }
}
