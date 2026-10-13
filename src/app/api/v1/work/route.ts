import type { NextRequest } from 'next/server'
import { handleBffRoute } from '../_utils/bff'
import * as work from '@/server/app-api/v1/work/route'

export async function GET(request: NextRequest) { return handleBffRoute(request, {}, work.GET) }
export async function POST(request: NextRequest) { return handleBffRoute(request, {}, work.POST) }
