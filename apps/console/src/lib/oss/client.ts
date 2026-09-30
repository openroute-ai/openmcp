import OSS from "ali-oss"
import * as prettier from "prettier"
import { hasAliyunOss, syncEnv } from "@/lib/env"

export type OssAssetType = "icon" | "og-image" | "readme-images" | "avatar"

/**
 * Aliyun OSS bucket used to publish the generated JSON artefacts and to
 * mirror repository icons, Open Graph images and README images.
 *
 * Every method is a no-op returning a falsy value when the bucket is not
 * configured, so tasks that publish artefacts still complete (and record
 * what they would have published) in an environment without OSS credentials.
 * The source app threw on a missing key, which aborted whole task runs.
 */
export class AliyunOSSClient {
  private client: OSS | undefined

  isEnabled(): boolean {
    return hasAliyunOss()
  }

  private getClient(): OSS {
    if (this.client) return this.client

    const env = syncEnv()
    if (!hasAliyunOss()) {
      throw new Error(
        "Aliyun OSS is not configured. Set ALIYUN_ACCESS_KEY_ID, " +
          "ALIYUN_ACCESS_KEY_SECRET, ALIYUN_OSS_BUCKET and ALIYUN_OSS_REGION."
      )
    }

    this.client = new OSS({
      accessKeyId: env.ALIYUN_ACCESS_KEY_ID!,
      accessKeySecret: env.ALIYUN_ACCESS_KEY_SECRET!,
      bucket: env.ALIYUN_OSS_BUCKET!,
      region: env.ALIYUN_OSS_REGION!,
      secure: true,
    })
    return this.client
  }

  /** Public base URL of the bucket, without a trailing slash. */
  baseUrl(): string {
    const env = syncEnv()
    if (!env.ALIYUN_OSS_REGION || !env.ALIYUN_OSS_BUCKET) return ""
    return `https://${env.ALIYUN_OSS_BUCKET}.oss-${env.ALIYUN_OSS_REGION}.aliyuncs.com`
  }

  /**
   * Streams a remote file into the bucket.
   *
   * The source app downloaded to a temp file on disk and uploaded that,
   * which fails on serverless where the filesystem is read-only or
   * ephemeral. The buffer is held in memory instead.
   */
  async uploadFromUrl(
    url: string,
    ossPath: string
  ): Promise<string | undefined> {
    if (!this.isEnabled()) return undefined

    const response = await fetch(url, { redirect: "follow" })
    if (!response.ok) {
      throw new Error(
        `Could not download ${url}: ${response.status} ${response.statusText}`
      )
    }

    const contentType = response.headers.get("content-type")
    const body = Buffer.from(await response.arrayBuffer())

    const result = await this.getClient().put(ossPath, body, {
      ...(contentType ? { headers: { "Content-Type": contentType } } : {}),
    })
    return result.url
  }

  async uploadBuffer(
    buffer: Buffer,
    ossPath: string,
    headers?: Record<string, string>
  ): Promise<string> {
    const result = await this.getClient().put(ossPath, buffer, {
      ...(headers ? { headers } : {}),
    })
    return result.url
  }

  /**
   * Builds a versioned object path. The timestamp keeps republished assets
   * from being served stale by a CDN that has not revalidated yet.
   */
  generateOSSPath(
    type: OssAssetType,
    repoName: string,
    fileName: string
  ): string {
    const extension = fileName.split(".").pop() || "png"
    return `mcp/repos/${repoName}/${type}/${Date.now()}.${extension}`
  }

  /**
   * An author's mirrored avatar, keyed by their login rather than a repository.
   *
   * Its own path because an avatar belongs to the account, not to any one
   * repository: putting it under a repository would re-upload the same picture
   * once per repository the author happens to own.
   */
  generateAuthorAvatarPath(username: string): string {
    return `mcp/authors/${username}/avatar/${Date.now()}.png`
  }

  async exists(ossPath: string): Promise<boolean> {
    if (!this.isEnabled()) return false
    try {
      await this.getClient().head(ossPath)
      return true
    } catch {
      return false
    }
  }

  /** Publishes a pretty-printed JSON artefact. */
  async saveJSON(json: unknown, fileName: string): Promise<string | undefined> {
    if (!this.isEnabled()) return undefined

    const formatted = await prettier.format(JSON.stringify(json), {
      parser: "json",
    })
    const result = await this.getClient().put(
      `json-files/${fileName}`,
      Buffer.from(formatted, "utf-8"),
      { headers: { "Content-Type": "application/json" } }
    )
    return result.url
  }

  /** Reads back a previously published artefact. */
  async readJSON(fileName: string): Promise<unknown> {
    const result = await this.getClient().get(`json-files/${fileName}`)
    return JSON.parse(result.content.toString("utf-8"))
  }
}

export const ossClient = new AliyunOSSClient()
