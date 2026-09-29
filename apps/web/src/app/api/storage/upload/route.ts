import { type NextRequest, NextResponse } from 'next/server'
import { StorageError } from '@workspace/storage'
import { getStorageProvider, StorageConfigurationError } from '@/server/storage/provider'
import { getUploadUserId, unauthorizedUpload } from '@/server/storage/guard'
import {
  folderForScope,
  isUploadScope,
  objectNameFor,
  UPLOAD_SCOPES,
} from '@/server/storage/policy'

/**
 * Multipart upload for small files; the browser helper only reaches this route
 * below the presign threshold, so request bodies stay modest.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const userId = await getUploadUserId()
  if (!userId) return unauthorizedUpload()

  let file: File | null = null
  let scope: unknown
  try {
    const formData = await request.formData()
    const candidate = formData.get('file')
    scope = formData.get('scope')
    file = candidate instanceof File ? candidate : null
  } catch {
    return NextResponse.json({ error: 'Invalid multipart payload' }, { status: 400 })
  }

  if (!isUploadScope(scope)) {
    return NextResponse.json({ error: 'Invalid upload scope' }, { status: 400 })
  }

  const policy = UPLOAD_SCOPES[scope]
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const contentType = file.type.toLowerCase()
  if (!policy.contentTypes.includes(contentType as never)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 400 })
  }

  if (file.size <= 0) {
    return NextResponse.json({ error: 'File is empty' }, { status: 400 })
  }
  if (file.size > policy.maxBytes) {
    return NextResponse.json(
      { error: 'File exceeds the size limit for this upload' },
      { status: 400 }
    )
  }

  const filename = objectNameFor(contentType)
  if (!filename) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 400 })
  }

  try {
    const provider = getStorageProvider()
    const result = await provider.uploadFile({
      file: Buffer.from(await file.arrayBuffer()),
      filename,
      contentType,
      folder: folderForScope(scope, userId),
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof StorageConfigurationError) {
      console.error('[storage] upload attempted without configuration')
      return NextResponse.json({ error: 'Storage is not configured' }, { status: 503 })
    }
    console.error('[storage] upload failed', error)
    if (error instanceof StorageError) {
      return NextResponse.json({ error: 'Upload failed' }, { status: 502 })
    }
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
