/**
 * Normalise PEM material that arrived via an environment variable.
 *
 * Hosts often store keys as a single line with literal `\n`, or as the bare
 * base64 body without headers. Node's crypto APIs need a well-formed PEM.
 */
export function normalizePem(
  value: string,
  kind: 'PRIVATE KEY' | 'RSA PRIVATE KEY' | 'PUBLIC KEY' | 'CERTIFICATE'
): string {
  let key = value.trim().replace(/\\n/g, '\n')
  if (key.includes('BEGIN')) return key
  const body = key.replace(/\s+/g, '')
  const lines = body.match(/.{1,64}/g) ?? [body]
  return `-----BEGIN ${kind}-----\n${lines.join('\n')}\n-----END ${kind}-----`
}
