/**
 * Only same-site absolute paths may be used as a post-sign-in destination.
 *
 * Anything protocol-relative (`//evil.com`) or absolute (`https://evil.com`)
 * would turn the sign-in page into an open redirect, so those fall back to the
 * default route.
 */
export function safeCallbackUrl(value: string | null, fallback = '/'): string {
  if (!value) return fallback
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback
  return value
}
