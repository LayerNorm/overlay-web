import { NextResponse } from 'next/server'

import { listAdminCatalogResources } from '@/server/catalog'
import { adminRoute } from '@/server/guard'

export const GET = adminRoute(async () => {
  const resources = await listAdminCatalogResources()
  return NextResponse.json({ resources })
})
