import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'

/**
 * Resolves the signed-in user id for an upload request, or null.
 *
 * Uploads are always scoped to a real account: without a session there is no
 * folder to write into, and an anonymous endpoint that proxies bytes to object
 * storage is an open file host with the platform's credentials behind it.
 */
export const getUploadUserId = async (): Promise<string | null> => {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user?.id ?? null
}

export const unauthorizedUpload = (): NextResponse =>
  NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
