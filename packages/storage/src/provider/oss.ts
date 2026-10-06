import OSS, { type OSSClientOptions } from 'ali-oss'
import { randomUUID } from 'crypto'
import {
  ConfigurationError,
  type PresignedUploadUrlParams,
  type StorageConfig,
  StorageError,
  type StorageProvider,
  UploadError,
  type UploadFileParams,
  type UploadFileResult,
} from '../types'

/**
 * `ali-oss` derives the request host on its own and offers no way to opt out:
 *
 * - `endpoint` is used verbatim as the base host and the bucket is *always*
 *   prepended to it (`getReqUrl`), so a bucket-qualified endpoint such as
 *   `https://my-bucket.oss-cn-hangzhou.aliyuncs.com` would be requested as
 *   `https://my-bucket.my-bucket.oss-cn-hangzhou.aliyuncs.com`.
 * - without an `endpoint`, `region` is turned into
 *   `<region><-internal.>.aliyuncs.com` (`setRegion`), so it must already carry
 *   the `oss-` prefix that the OSS console omits in its region picker.
 *
 * Operators reasonably write either spelling, so both are accepted and
 * normalised here rather than failing at request time with a DNS or TLS error.
 */

/** `cn-hangzhou` -> `oss-cn-hangzhou`; already-prefixed and VPC ids pass through. */
export function normalizeOssRegion(region: string): string {
  const trimmed = region.trim()
  if (!trimmed) return trimmed
  if (/^(oss-|vpc100-oss-)/i.test(trimmed)) return trimmed
  return `oss-${trimmed}`
}

/** Drops a leading `<bucket>.` label from the endpoint host, which `ali-oss` adds itself. */
export function normalizeOssEndpoint(endpoint: string, bucketName?: string): string {
  const trimmed = endpoint.trim()
  if (!trimmed || !bucketName) return trimmed

  const schemeMatch = /^[a-z][a-z0-9+.-]*:\/\//i.exec(trimmed)
  const scheme = schemeMatch ? schemeMatch[0] : ''
  const authority = trimmed.slice(scheme.length)
  const slashAt = authority.indexOf('/')
  const userinfoAt = authority.lastIndexOf('@')
  const hostStart = userinfoAt === -1 ? 0 : userinfoAt + 1
  const hostEnd = slashAt === -1 ? authority.length : slashAt

  // Compare the host label only, so a host that merely *contains* the bucket
  // name (`zijiejuli-mirror.oss-...`) is left alone.
  const label = `${bucketName.toLowerCase()}.`
  if (!authority.slice(hostStart, hostEnd).toLowerCase().startsWith(label)) return trimmed

  const host = authority.slice(hostStart + label.length, hostEnd)
  return scheme + authority.slice(0, hostStart) + host + authority.slice(hostEnd)
}

/**
 * Alibaba Cloud OSS storage provider implementation
 *
 * This provider works with Alibaba Cloud Object Storage Service (OSS)
 * https://www.alibabacloud.com/product/oss
 *
 * docs:
 * https://openroute.cn/docs/storage
 */
export class OSSProvider implements StorageProvider {
  private config: StorageConfig
  private ossClient: OSS | null = null

  constructor(config: StorageConfig) {
    this.config = config
  }

  public getConfig(): StorageConfig {
    return this.config
  }

  /**
   * Get the provider name
   */
  public getProviderName(): string {
    return 'oss'
  }

  /**
   * Get the OSS client instance
   */
  private getOSSClient(): OSS {
    if (this.ossClient) {
      return this.ossClient
    }

    const { region, accessKeyId, secretAccessKey, bucketName, endpoint, ossInternal, ossSecure } = this.config

    if (!region) {
      throw new ConfigurationError('Storage region is not configured')
    }

    if (!bucketName) {
      throw new ConfigurationError('Storage bucket name is not configured')
    }

    const clientOptions: OSSClientOptions = {
      region: normalizeOssRegion(region),
      accessKeyId,
      accessKeySecret: secretAccessKey,
      bucket: bucketName,
    }

    // Add custom endpoint if provided
    if (endpoint) {
      clientOptions.endpoint = normalizeOssEndpoint(endpoint, bucketName)
    }

    // Add OSS specific configurations
    if (ossInternal !== undefined) {
      clientOptions.internal = ossInternal
    }

    if (ossSecure !== undefined) {
      clientOptions.secure = ossSecure
    }

    this.ossClient = new OSS(clientOptions)
    return this.ossClient
  }

  /**
   * Generate a unique filename with the original extension
   */
  private generateUniqueFilename(originalFilename: string): string {
    const extension = originalFilename.split('.').pop() || ''
    const uuid = randomUUID()
    return `${uuid}${extension ? `.${extension}` : ''}`
  }

  /**
   * Upload a file to OSS
   */
  public async uploadFile(params: UploadFileParams): Promise<UploadFileResult> {
    try {
      const { file, filename, contentType, folder } = params
      const oss = this.getOSSClient()
      const { publicUrl } = this.config

      const uniqueFilename = this.generateUniqueFilename(filename)
      const key = folder ? `${folder}/${uniqueFilename}` : uniqueFilename

      // Convert Blob to Buffer if needed
      let fileBuffer: Buffer
      if (file instanceof Blob) {
        fileBuffer = Buffer.from(await file.arrayBuffer())
      } else {
        fileBuffer = file
      }

      // Upload the file
      await oss.put(key, fileBuffer, {
        mime: contentType,
      })

      // Generate the URL
      let url: string
      if (publicUrl) {
        // Use custom domain if provided
        url = `${publicUrl.replace(/\/$/, '')}/${key}`
      } else {
        // Generate a signed URL if no public URL is provided
        url = oss.signatureUrl(key, { expires: 3600 * 24 * 7 }) // 7 days
      }

      return { url, key }
    } catch (error) {
      if (error instanceof ConfigurationError) {
        console.error('uploadFile, configuration error', error)
        throw error
      }

      const message = error instanceof Error ? error.message : 'Unknown error occurred during file upload'
      console.error('uploadFile, error', message)
      throw new UploadError(message)
    }
  }

  /**
   * Delete a file from OSS
   */
  public async deleteFile(key: string): Promise<void> {
    try {
      const oss = this.getOSSClient()
      await oss.delete(key)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error occurred during file deletion'
      console.error('deleteFile, error', message)
      throw new StorageError(message)
    }
  }

  /**
   * Generate a pre-signed URL for direct browser uploads
   */
  public async getPresignedUploadUrl(params: PresignedUploadUrlParams): Promise<UploadFileResult> {
    try {
      const { filename, contentType, folder, expiresIn = 3600 } = params
      const oss = this.getOSSClient()

      const uniqueFilename = this.generateUniqueFilename(filename)
      const key = folder ? `${folder}/${uniqueFilename}` : uniqueFilename

      const url = oss.signatureUrl(key, {
        method: 'PUT',
        expires: expiresIn,
        'Content-Type': contentType,
      })

      return { url, key }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error occurred while generating presigned URL'
      console.error('getPresignedUploadUrl, error', message)
      throw new StorageError(message)
    }
  }
}
