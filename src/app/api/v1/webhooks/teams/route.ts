import { after, NextResponse } from 'next/server'
import { handleTeamsNotifications } from '@/server/sync/teams/inbound'
import { verifiedTeamsNotifications } from '@/server/sync/teams/notifications'

/**
 * Microsoft Graph change and lifecycle notifications for Teams channel sync,
 * and the messaging endpoint of the notification-only Teams bot. Session-free:
 * Graph proves itself with the clientState we signed per link. A
 * validationToken request is echoed as plain text, as Graph requires when a
 * subscription is created. Everything else answers 202 at once and is applied
 * after the response; Bot Framework activities carry no clientState and are
 * ignored.
 */
export async function POST(request: Request) {
  const validationToken = new URL(request.url).searchParams.get('validationToken')
  if (validationToken !== null) {
    return new NextResponse(validationToken, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  const items = verifiedTeamsNotifications(await request.text())
  if (items.length > 0) after(async () => { await handleTeamsNotifications(items) })
  return new NextResponse(null, { status: 202 })
}
