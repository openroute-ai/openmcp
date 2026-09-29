import type { UploadFileResult } from './types'

/**
 * Client-side upload helper.
 *
 * Small files (< 10MB) go through a single multipart POST to the host app,
 * which proxies to the storage provider. Larger files use a pre-signed URL so
 * bytes move directly from the browser to S3/OSS.
 *
 * All three endpoints are supplied by the host app so this module carries no
 * assumptions about the consuming app's route layout.
 */
export interface BrowserUploadOptions {
  uploadEndpoint: string
  presignedUrlEndpoint: string
  fileUrlEndpoint: string
  appName?: string
  /** Bytes below which the single-shot upload path is used. Defaults to 10MB. */
  smallFileThreshold?: number
}

const DEFAULT_SMALL_FILE_THRESHOLD = 10 * 1024 * 1024

const readError = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { message?: string }
    return body.message || `Request failed: ${response.status}`
  } catch {
    return `Request failed: ${response.status}`
  }
}

export const uploadFileFromBrowser = async (
  file: File,
  folder: string | undefined,
  options: BrowserUploadOptions
): Promise<UploadFileResult> => {
  const {
    uploadEndpoint,
    presignedUrlEndpoint,
    fileUrlEndpoint,
    appName = 'openroute',
    smallFileThreshold = DEFAULT_SMALL_FILE_THRESHOLD,
  } = options

  try {
    if (file.size < smallFileThreshold) {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('folder', `${appName}/${folder ?? ''}`)

      const response = await fetch(uploadEndpoint, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error(await readError(response))
      }

      return (await response.json()) as UploadFileResult
    }

    const presignedResponse = await fetch(presignedUrlEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
        folder: folder ?? '',
      }),
    })

    if (!presignedResponse.ok) {
      throw new Error(await readError(presignedResponse))
    }

    const { url, key } = (await presignedResponse.json()) as {
      url: string
      key: string
    }

    const uploadResponse = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    })

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload file using pre-signed URL')
    }

    const fileUrlResponse = await fetch(fileUrlEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    })

    if (!fileUrlResponse.ok) {
      throw new Error(await readError(fileUrlResponse))
    }

    return (await fileUrlResponse.json()) as UploadFileResult
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unknown error occurred during file upload'
    throw new Error(message)
  }
}
