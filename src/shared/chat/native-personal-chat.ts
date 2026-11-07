type PersonalChatFields = {
  _id: string
  workspaceId?: string
  conversationType?: string
  scope?: string
}

export function isNativePersonalChatCandidate(
  chat: PersonalChatFields,
  workspaceId: string | null | undefined,
): boolean {
  void workspaceId
  return (chat.conversationType ?? 'personal') === 'personal'
}

export function excludeNativePersonalChats<Row extends PersonalChatFields>(
  chats: readonly Row[],
  workspaceId: string | null | undefined,
): Row[] {
  return chats.filter((chat) => !isNativePersonalChatCandidate(chat, workspaceId))
}
