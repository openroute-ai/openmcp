import type { StorageConfig } from '../types'

/**
 * Builds a StorageConfig from environment variables.
 *
 * This lives in the package (rather than being a module-level singleton) so the
 * consuming app decides when and whether to read `process.env` — the package
 * itself has no opinion about the host runtime.
 */
export function storageConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): StorageConfig {
  return {
    region: env.STORAGE_REGION ?? '',
    endpoint: env.STORAGE_ENDPOINT,
    accessKeyId: env.STORAGE_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY ?? '',
    bucketName: env.STORAGE_BUCKET_NAME ?? '',
    publicUrl: env.STORAGE_PUBLIC_URL,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE !== 'false',
    ossInternal: env.STORAGE_OSS_INTERNAL === 'true',
    ossSecure: env.STORAGE_OSS_SECURE !== 'false',
  }
}
