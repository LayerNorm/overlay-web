import type { NextRequest } from 'next/server'
import { handleBffRoute } from '../../_utils/bff'
import * as work from '@/server/app-api/v1/work/route'

type Context = { params: Promise<{ id: string }> }
export async function GET(request: NextRequest, context: Context) { return handleBffRoute(request, context, work.getWork) }
export async function PATCH(request: NextRequest, context: Context) { return handleBffRoute(request, context, work.updateWork) }
export async function POST(request: NextRequest, context: Context) { return handleBffRoute(request, context, work.actionWork) }
export async function DELETE(request: NextRequest, context: Context) { return handleBffRoute(request, context, work.archiveWork) }
