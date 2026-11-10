import type { NextRequest } from 'next/server'
import { unlinkSlackIdentityRoute } from '@/server/surfaces/slack-identity-routes'

export async function POST(request: NextRequest) { return await unlinkSlackIdentityRoute(request) }
