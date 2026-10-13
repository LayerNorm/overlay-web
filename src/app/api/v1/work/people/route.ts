import type { NextRequest } from 'next/server'
import { handleBffRoute } from '../../_utils/bff'
import { peopleWork } from '@/server/app-api/v1/work/route'
export async function GET(request: NextRequest) { return handleBffRoute(request, {}, peopleWork) }
