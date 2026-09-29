import { type NextRequest, NextResponse } from 'next/server'
import { StorageError } from '@workspace/storage'
import {
  getStorageProvider,
  publicUrlFor,
  StorageConfigurationError,
} from '@/server/storage/provider'
import { getUploadUserId, unauthorizedUpload } from '@/server/storage/guard'
import {
  folderForScope,
  isUploadScope,
  objectNameFor,
  UPLOAD_SCOPES,
} from '@/server/storage/policy'

/** Presigned PUTs are short-lived; a leaked URL should stop working quickly. */
const PRESIGN_EXPIRY_SECONDS = 600

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Issues a presigned PUT URL so large files stream straight from the browser
 * to the bucket instead of proxying through this app.
 *
 * Like the multipart route, the caller must be signed in and the destination is
 * derived from the scope plus their own user id. The client cannot name the
 * object, the folder, or the expiry.
 */
export async function POST(request: NextRequest) {
  const userId = await getUploadUserId()
  if (!userId) return unauthorizedUpload()

  let body: { contentType?: unknown; scope?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  const { scope, contentType: rawContentType } = body
  if (!isUploadScope(scope)) {
    return NextResponse.json({ error: 'Invalid upload scope' }, { status: 400 })
  }
  if (typeof rawContentType !== 'string') {
    return NextResponse.json({ error: 'Content type is required' }, { status: 400 })
  }

  const policy = UPLOAD_SCOPES[scope]
  const contentType = rawContentType.toLowerCase()
  if (!policy.contentTypes.includes(contentType as never)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 400 })
  }

  const filename = objectNameFor(contentType)
  if (!filename) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 400 })
  }

  try {
    const provider = getStorageProvider()
    const result = await provider.getPresignedUploadUrl({
      filename,
      contentType,
      folder: folderForScope(scope, userId),
      expiresIn: PRESIGN_EXPIRY_SECONDS,
    })
    const readUrl = publicUrlFor(result.key)
    if (!readUrl) {
      console.error('[storage] STORAGE_PUBLIC_URL missing, refusing presign')
      return NextResponse.json({ error: 'Storage is not configured' }, { status: 503 })
    }
    return NextResponse.json({ uploadUrl: result.url, key: result.key, readUrl })
  } catch (error) {
    if (error instanceof StorageConfigurationError) {
      console.error('[storage] presign attempted without configuration')
      return NextResponse.json({ error: 'Storage is not configured' }, { status: 503 })
    }
    console.error('[storage] presign failed', error)
    if (error instanceof StorageError) {
      return NextResponse.json({ error: 'Could not create upload URL' }, { status: 502 })
    }
    return NextResponse.json({ error: 'Could not create upload URL' }, { status: 500 })
  }
}
