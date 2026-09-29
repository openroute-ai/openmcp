'use client'

import type { UploadScope } from '@/server/storage/policy'

/**
 * Browser uploads for marketplace and KYC files.
 *
 * Small files go through the app as multipart form data; anything above the
 * threshold is streamed straight to object storage with a presigned PUT. Both
 * paths are authenticated, and in both cases the server picks the destination
 * object name and folder — the browser only supplies the bytes and a scope.
 */

/** Matches the threshold documented on the server-side helpers. */
const PRESIGN_THRESHOLD_BYTES = 10 * 1024 * 1024

const UPLOAD_ENDPOINT = '/api/storage/upload'
const PRESIGN_ENDPOINT = '/api/storage/presigned-url'

export interface UploadResult {
  /** Stable, publicly readable URL. Persist this. */
  url: string
  /** Storage object key, useful for later deletion. */
  key: string
}

const readError = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: string }
    return body.error || `Upload failed: ${response.status}`
  } catch {
    return `Upload failed: ${response.status}`
  }
}

const uploadSmallFile = async (
  file: File,
  scope: UploadScope
): Promise<UploadResult> => {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('scope', scope)

  const response = await fetch(UPLOAD_ENDPOINT, {
    method: 'POST',
    body: formData,
  })
  if (!response.ok) {
    throw new Error(await readError(response))
  }
  return (await response.json()) as UploadResult
}

const uploadViaPresignedUrl = async (
  file: File,
  scope: UploadScope
): Promise<UploadResult> => {
  const presignResponse = await fetch(PRESIGN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, contentType: file.type }),
  })
  if (!presignResponse.ok) {
    throw new Error(await readError(presignResponse))
  }

  const { uploadUrl, key, readUrl } = (await presignResponse.json()) as {
    uploadUrl: string
    key: string
    readUrl: string
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  if (!uploadResponse.ok) {
    throw new Error('Failed to upload file to storage')
  }

  return { url: readUrl, key }
}

export const uploadFileToStorage = async (
  file: File,
  scope: UploadScope
): Promise<UploadResult> => {
  if (file.size === 0) {
    throw new Error('Cannot upload an empty file')
  }

  return file.size < PRESIGN_THRESHOLD_BYTES
    ? uploadSmallFile(file, scope)
    : uploadViaPresignedUrl(file, scope)
}
