/// <reference path="./ali-oss.d.ts" />
// The reference above pulls the ambient `ali-oss` declarations into the program
// of any app that imports this package. Without it those declarations only exist
// when this package is typechecked on its own, and a consuming app that reaches
// provider/oss.ts sees `ali-oss` as an untyped module.
import { storageConfigFromEnv } from './config/storage-config'
import { OSSProvider } from './provider/oss'
import { S3Provider } from './provider/s3'
import type {
  StorageConfig,
  StorageProvider,
  UploadFileResult,
} from './types'

export { storageConfigFromEnv } from './config/storage-config'
export { OSSProvider } from './provider/oss'
export { S3Provider } from './provider/s3'
export type {
  PresignedUploadUrlParams,
  StorageConfig,
  StorageProvider,
  UploadFileParams,
  UploadFileResult,
} from './types'
export {
  ConfigurationError,
  StorageError,
  UploadError,
} from './types'

export type StorageProviderName = 's3' | 'oss'

/**
 * Storage configuration owned by the host application.
 *
 * The package never reads env or a website config on its own; the app passes
 * this in so provider selection stays an application decision.
 */
export interface StorageOptions {
  provider: StorageProviderName
  config: StorageConfig
  /** Folder prefix applied to every object key. */
  appName?: string
}

/**
 * Creates a storage provider for the given options.
 *
 * Throws when the provider name is not one of the supported backends so a
 * typo fails loudly instead of silently disabling uploads.
 */
export const createStorageProvider = (options: StorageOptions): StorageProvider => {
  const { provider, config } = options
  if (provider === 's3') {
    return new S3Provider(config)
  }
  if (provider === 'oss') {
    return new OSSProvider(config)
  }
  throw new Error(`Unsupported storage provider: ${provider}`)
}

/**
 * Creates a storage provider from environment variables.
 *
 * Reads STORAGE_PROVIDER (defaulting to "s3") plus the STORAGE_* credentials
 * documented in README.md.
 */
export const createStorageProviderFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
  appName = 'openroute'
): StorageProvider =>
  createStorageProvider({
    provider: (env.STORAGE_PROVIDER as StorageProviderName | undefined) ?? 's3',
    config: storageConfigFromEnv(env),
    appName,
  })

/* -------------------------------------------------------------------------- */
/* Thin, provider-agnostic helpers                                            */
/* -------------------------------------------------------------------------- */

export const uploadFile = (
  provider: StorageProvider,
  file: Buffer | Blob,
  filename: string,
  contentType: string,
  folder?: string
): Promise<UploadFileResult> =>
  provider.uploadFile({ file, filename, contentType, folder })

export const deleteFile = (
  provider: StorageProvider,
  key: string
): Promise<void> => provider.deleteFile(key)

export const getPresignedUploadUrl = (
  provider: StorageProvider,
  filename: string,
  contentType: string,
  folder?: string,
  expiresIn = 3600
): Promise<UploadFileResult> =>
  provider.getPresignedUploadUrl({ filename, contentType, folder, expiresIn })
