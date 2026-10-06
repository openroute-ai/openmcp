import {
  createStorageProviderFromEnv,
  type StorageProvider,
} from '@workspace/storage'

/**
 * Server-side object storage access.
 *
 * The provider is built lazily and cached, so importing this module never throws
 * in environments that have no storage credentials (CI, unit tests, the parts of
 * the app that never touch uploads). Callers go through `getStorageProvider()`
 * and get an explicit `StorageConfigurationError` when the deployment has not
 * opted into storage yet.
 */

/**
 * `STORAGE_REGION` is part of the gate even though the providers also guard it:
 * both the OSS and the S3 client refuse to start without a region, so leaving it
 * out only moved the failure from an actionable 503 to a bare "Upload failed".
 */
const REQUIRED_ENV = [
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'STORAGE_BUCKET_NAME',
  'STORAGE_REGION',
  'STORAGE_PUBLIC_URL',
] as const

/**
 * Raised when a request reaches an upload endpoint but the deployment has no
 * usable storage credentials. The API routes turn this into a 503.
 */
export class StorageConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageConfigurationError'
  }
}

/** Names of the required variables this process is missing, in gate order. */
export const missingStorageEnv = (): string[] =>
  REQUIRED_ENV.filter((name) => !process.env[name])

export const isStorageConfigured = (): boolean => missingStorageEnv().length === 0

/**
 * The stable, publicly readable URL for an object key.
 *
 * `STORAGE_PUBLIC_URL` is required rather than optional. Without it the storage
 * providers fall back to a *pre-signed GET* URL, which expires — and the
 * resulting string is exactly what we would then persist in a provider profile
 * or listing row, leaving a permanently broken image link behind. Failing at
 * configuration time is better than silently storing expiring URLs.
 */
export const publicUrlFor = (key: string): string | null => {
  const publicUrl = process.env.STORAGE_PUBLIC_URL
  if (!publicUrl) return null
  return `${publicUrl.replace(/\/$/, '')}/${key}`
}

let cached: StorageProvider | null = null

export const getStorageProvider = (): StorageProvider => {
  if (cached) return cached

  const missing = missingStorageEnv()
  if (missing.length > 0) {
    throw new StorageConfigurationError(
      `Object storage is not configured. Missing: ${missing.join(', ')}.`
    )
  }

  cached = createStorageProviderFromEnv(process.env, 'openmcp')
  return cached
}
