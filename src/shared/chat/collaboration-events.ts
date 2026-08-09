export const NEW_DIRECT_MESSAGE_EVENT = 'overlay:new-direct-message'
export const NEW_CHANNEL_EVENT = 'overlay:new-channel'
export const COLLABORATION_NOTIFICATIONS_CHANGED_EVENT = 'overlay:collaboration-notifications-changed'

export function dispatchCollaborationNotificationsChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(COLLABORATION_NOTIFICATIONS_CHANGED_EVENT))
}
