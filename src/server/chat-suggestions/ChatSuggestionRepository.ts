import 'server-only'

export type ChatSuggestionSnapshot = {
  day: string
  prompts: string[]
}

export interface ChatSuggestionRepository {
  getByUserId(userId: string): Promise<ChatSuggestionSnapshot | null>
  setForUser(args: ChatSuggestionSnapshot & { userId: string }): Promise<boolean>
}
