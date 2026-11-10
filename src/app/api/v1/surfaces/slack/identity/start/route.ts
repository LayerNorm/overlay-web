import type { NextRequest } from 'next/server'
import { startSlackIdentity } from '@/server/surfaces/slack-identity-routes'

export async function GET(request: NextRequest) { return await startSlackIdentity(request) }
