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
      region,
      accessKeyId,
      accessKeySecret: secretAccessKey,
      bucket: bucketName,
    }

    // Add custom endpoint if provided
    if (endpoint) {
      clientOptions.endpoint = endpoint
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
        console.log('uploadFile, public url', url)
      } else {
        // Generate a signed URL if no public URL is provided
        url = oss.signatureUrl(key, { expires: 3600 * 24 * 7 }) // 7 days
        console.log('uploadFile, signed url', url)
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
