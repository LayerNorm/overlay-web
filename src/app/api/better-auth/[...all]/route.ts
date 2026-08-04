import { toNextJsHandler } from 'better-auth/next-js'
import { getBetterAuth } from '@/server/auth/better-auth'
const handlers = toNextJsHandler((request) => getBetterAuth().handler(request))

export const GET = handlers.GET
export const POST = handlers.POST
export const PATCH = handlers.PATCH
export const PUT = handlers.PUT
export const DELETE = handlers.DELETE
