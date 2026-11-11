import { NextResponse } from 'next/server'

const TEAM_ID = '562STT95YC'
const BUNDLE_ID = 'com.layernorm.overlay-mobile'
const APP_ID = `${TEAM_ID}.${BUNDLE_ID}`
const PATHS = [
  '/auth/native/callback',
  '/auth/native/callback/*',
  '/share/*',
  '/invitations/*',
  '/app/invitations/*',
  '/work',
  '/work/*',
  '/agents',
  '/agents/*',
  '/agent/*',
  '/dm/*',
  '/chat',
  '/chat/*',
  '/channel/*',
  '/thread/*',
  '/files',
  '/files/*',
  '/note/*',
  '/automations',
  '/automations/*',
  '/settings',
  '/settings/*',
  '/activity',
  '/search',
  '/app/work',
  '/app/work/*',
  '/app/agents',
  '/app/agents/*',
  '/app/chat',
  '/app/chat/*',
  '/app/files',
  '/app/files/*',
  '/app/automations',
  '/app/automations/*',
  '/app/settings',
  '/app/settings/*',
]

export async function GET() {
  return NextResponse.json(
    {
      applinks: {
        apps: [],
        details: [
          {
            appID: APP_ID,
            appIDs: [APP_ID],
            paths: PATHS,
            components: PATHS.map((path) => ({ '/': path })),
          },
        ],
      },
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
      },
    },
  )
}
