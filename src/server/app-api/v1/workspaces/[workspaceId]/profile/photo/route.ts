import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import {
  GET_PHOTO as getWorkspaceProfilePhoto,
  uploadPhoto as uploadWorkspaceProfilePhoto,
} from '@/server/app-api/v1/workspaces/[workspaceId]/profile/route'

export async function GET(request: Request, context: AppApiRouteContext) {
  return getWorkspaceProfilePhoto(request, context)
}

export async function POST(request: Request, context: AppApiRouteContext) {
  return uploadWorkspaceProfilePhoto(request, context)
}
