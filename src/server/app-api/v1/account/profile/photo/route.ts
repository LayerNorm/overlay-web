import type { AccountAppApiRouteContext } from '@/server/app-api/bff-context'
import {
  GET_PHOTO as getAccountProfilePhoto,
  uploadPhoto as uploadAccountProfilePhoto,
} from '@/server/app-api/v1/account/profile/route'

export async function GET(request: Request, context: AccountAppApiRouteContext) {
  return getAccountProfilePhoto(request, context)
}

export async function POST(request: Request, context: AccountAppApiRouteContext) {
  return uploadAccountProfilePhoto(request, context)
}
