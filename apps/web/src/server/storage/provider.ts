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

const REQUIRED_ENV = [
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'STORAGE_BUCKET_NAME',
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

export const isStorageConfigured = (): boolean =>
  REQUIRED_ENV.every((name) => Boolean(process.env[name]))

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

  if (!isStorageConfigured()) {
    throw new StorageConfigurationError(
      `Object storage is not configured. Set ${REQUIRED_ENV.join(', ')}.`
    )
  }

  cached = createStorageProviderFromEnv(process.env, 'openmcp')
  return cached
}
