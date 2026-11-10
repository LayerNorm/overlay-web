import type { NextRequest } from 'next/server'
import { callbackSlackIdentity } from '@/server/surfaces/slack-identity-routes'

export async function GET(request: NextRequest) { return await callbackSlackIdentity(request) }
