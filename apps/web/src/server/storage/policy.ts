/**
 * Upload policy shared by the storage API routes.
 *
 * Two decisions here are deliberate and differ from a naive "just proxy the
 * file to the bucket" implementation:
 *
 * 1. The client never picks a destination. It sends a `scope` from this
 *    allowlist; the server derives the object folder from the scope plus the
 *    authenticated user id. Otherwise any signed-in user could write objects
 *    anywhere in the bucket, including over other users' files, by supplying
 *    their own `folder`.
 *
 * 2. The stored extension comes from the validated content type, not from the
 *    uploaded filename. A caller who sends `payload.html` with
 *    `Content-Type: image/png` would otherwise get an `.html` object written
 *    into a bucket that is probably served back over a public URL.
 */

/** Storage namespaces a client is allowed to write into. */
export const UPLOAD_SCOPES = {
  /** KYC identity documents: ID cards, business licence, authorisation. */
  kyc: {
    folder: 'kyc',
    contentTypes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ],
    maxBytes: 10 * 1024 * 1024,
  },
  /** Payout account QR codes. */
  payout: {
    folder: 'payout',
    contentTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 5 * 1024 * 1024,
  },
  /** Marketplace cover images and other listing assets. */
  asset: {
    folder: 'asset',
    contentTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 10 * 1024 * 1024,
  },
  /** Skill source archives. Large uploads should prefer the presigned path. */
  skill: {
    folder: 'skill',
    contentTypes: ['application/zip', 'application/x-zip-compressed'],
    maxBytes: 50 * 1024 * 1024,
  },
  /** Profile avatars and author/organisation images. */
  avatar: {
    folder: 'avatar',
    contentTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 5 * 1024 * 1024,
  },
} as const

export type UploadScope = keyof typeof UPLOAD_SCOPES

export const isUploadScope = (value: unknown): value is UploadScope =>
  typeof value === 'string' &&
  Object.prototype.hasOwnProperty.call(UPLOAD_SCOPES, value)

/**
 * Object extensions per allowed content type. Used instead of the client
 * filename's extension so a mismatched file cannot land as a dangerous type.
 */
const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
}

/** Object keys are generated server-side; the client filename is only a hint. */
const randomKey = (): string => globalThis.crypto.randomUUID()

export const extensionForContentType = (contentType: string): string | null =>
  EXTENSION_BY_CONTENT_TYPE[contentType.toLowerCase()] ?? null

/**
 * Builds the storage folder for a scope, namespaced by the caller's user id.
 * Returns null for an unknown scope.
 */
export const folderForScope = (scope: UploadScope, userId: string): string =>
  `${UPLOAD_SCOPES[scope].folder}/${userId}`

/**
 * A collision-resistant object name that carries no client-controlled path
 * segments. The original filename is intentionally not used.
 */
export const objectNameFor = (contentType: string): string | null => {
  const extension = extensionForContentType(contentType)
  if (!extension) return null
  return `${randomKey()}.${extension}`
}
