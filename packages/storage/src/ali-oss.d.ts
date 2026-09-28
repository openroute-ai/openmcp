/**
 * Minimal ambient declarations for `ali-oss`.
 *
 * The published package ships no type definitions, and this package only touches
 * a small slice of its API, so we describe exactly that slice instead of taking
 * on an unmaintained `@types` dependency.
 */
declare module 'ali-oss' {
  export interface OSSPutOptions {
    headers?: Record<string, string>
    mime?: string
  }

  export interface OSSSignatureOptions {
    expires?: number
    method?: 'GET' | 'PUT' | 'POST' | 'DELETE'
    contentType?: string
    headers?: Record<string, string>
    'Content-Type'?: string
    [key: string]: unknown
  }

  export interface OSSClientOptions {
    region: string
    accessKeyId: string
    accessKeySecret: string
    bucket: string
    endpoint?: string
    internal?: boolean
    secure?: boolean
  }

  export default class OSS {
    constructor(options: OSSClientOptions)

    put(
      name: string,
      file: Buffer | Uint8Array | string,
      options?: OSSPutOptions
    ): Promise<{ name: string; url: string }>

    delete(name: string): Promise<unknown>

    signatureUrl(name: string, options?: OSSSignatureOptions): string
  }

}
