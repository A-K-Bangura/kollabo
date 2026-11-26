import { handleApi } from '../server/router.js'

/**
 * Every /api route is served by this single function (see server/router.ts). Vercel's
 * Hobby plan allows 12 functions per deployment, and one catch-all keeps the API well
 * under that however many endpoints it grows to.
 */
export const GET = handleApi
export const POST = handleApi
export const PUT = handleApi
export const PATCH = handleApi
export const DELETE = handleApi
