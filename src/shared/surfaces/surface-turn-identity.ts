type SlackTurnSource = { teamId: string; channelId: string; messageId: string }

export function slackSurfaceTurnId(source: SlackTurnSource): string {
  return `surface:slack:${[source.teamId, source.channelId, source.messageId].map(encodeURIComponent).join(':')}`
}

export function isPersistedSlackTurnIdentity(source: SlackTurnSource & { bindingId: string; turnId: string }): boolean {
  return source.turnId === slackSurfaceTurnId(source)
    || source.turnId === `surface:slack:${source.bindingId}:${source.messageId}`
}
