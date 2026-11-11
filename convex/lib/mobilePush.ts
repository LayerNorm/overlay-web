import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { internal } from '../_generated/api'

export type PushSource =
  | { kind: 'activity'; id: Id<'workspaceNotifications'> }
  | { kind: 'wait'; id: Id<'harnessWaits'> }

export async function schedulePush(
  ctx: Pick<MutationCtx, 'db' | 'scheduler'>,
  source: PushSource,
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.notifications.push.deliver, { source })
}

export async function insertPushNotification(
  ctx: Pick<MutationCtx, 'db' | 'scheduler'>,
  value: Omit<Doc<'workspaceNotifications'>, '_id' | '_creationTime'>,
): Promise<Id<'workspaceNotifications'>> {
  const id = await ctx.db.insert('workspaceNotifications', value)
  await schedulePush(ctx, { kind: 'activity', id })
  return id
}
