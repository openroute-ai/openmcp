import { ossClient } from "@/lib/oss/client"
import { safeFetch } from "@/lib/net/safe-fetch"

const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".bmp",
  ".tiff",
]

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
  "image/x-icon": ".ico",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "image/tiff-fx": ".tiff",
  "image/avif": ".avif",
}

/**
 * README 里允许被镜像的图片来源。
 *
 * 白名单而不是「任意公网」：README 由仓库作者写，镜像这个动作等于让服务器替
 * 他发起一次带跳转的下载 —— 只放行图片真正可能出现的地方，剩下的地址一律保留
 * 原样（读者的浏览器照常能显示），既不给 SSRF 留入口，也不浪费一次出站请求。
 *
 * `.githubusercontent.com` 一族覆盖 raw / objects / avatars / camo / gist /
 * user-images；`.githubassets.com` 覆盖 `opengraph.githubassets.com`。
 */
const MIRROR_HOSTS = new Set(["github.com", "shields.io", "raw.github.com"])
const MIRROR_HOST_SUFFIXES = [".githubusercontent.com", ".githubassets.com"]

/** 是否是值得镜像的来源。地址本身格式不合法时按「不镜像」处理，不抛错。 */
function isMirrorableSource(url: string): boolean {
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  if (hostname.endsWith(".")) hostname = hostname.slice(0, -1)
  if (MIRROR_HOSTS.has(hostname)) return true
  return MIRROR_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
}

/**
 * Per-process memo of source URL to mirrored URL. Two READMEs that embed
 * the same badge image otherwise trigger two uploads per run, and a full
 * refresh touches thousands of READMEs.
 */
const mirroredImages = new Map<string, string>()

export type ImageMirror = (absoluteUrl: string) => Promise<string | undefined>

/**
 * Builds a mirror bound to one repository. Mirrors images to the configured
 * bucket; returns undefined when OSS is not configured or the image is
 * already hosted there, in which case the original URL is kept.
 */
function createOssMirror(repo: string): ImageMirror {
  return async (absoluteUrl) => {
    if (!ossClient.isEnabled()) return undefined
    if (isAlreadyHosted(absoluteUrl)) return undefined
    // Checked before `detectExtension`, which is itself a request: a source we
    // would refuse to mirror must not be probed either.
    if (!isMirrorableSource(absoluteUrl)) return undefined

    const cached = mirroredImages.get(absoluteUrl)
    if (cached) return cached

    const extension = await detectExtension(absoluteUrl)
    const fileName = `${fileNameWithoutExtension(absoluteUrl)}${extension}`
    const ossPath = ossClient.generateOSSPath("readme-images", repo, fileName)

    const url = await ossClient.uploadFromUrl(absoluteUrl, ossPath)
    if (url) mirroredImages.set(absoluteUrl, url)
    return url
  }
}

function isAlreadyHosted(url: string): boolean {
  return (
    url.includes("aliyuncs.com") ||
    url.includes("oss-") ||
    url.startsWith("data:")
  )
}

/**
 * Rewrites a README's relative links to absolute ones and, when an OSS
 * bucket is configured, mirrors its images so they keep resolving after the
 * source repository is gone.
 *
 * Never throws: a README that cannot be fully processed is still worth
 * storing, so the original text is returned on failure.
 */
export interface ProcessReadMeOptions {
  /**
   * Whether to mirror the README's images into the bucket. Defaults to true.
   *
   * A bulk backfill turns it off: mirroring costs one outbound download per
   * image, and a run whose only goal is to store the text should not pay that
   * (or, against a host it cannot reach, wait out a timeout for every image).
   * The link rewriting below still runs, so the stored Markdown is complete
   * and the original image URLs keep resolving in a reader's browser.
   */
  mirrorImages?: boolean
}

export async function processReadMeMd(
  md: string,
  repo: string,
  branch = "main",
  options: ProcessReadMeOptions = {}
): Promise<string> {
  const root = `https://github.com/${repo}`
  let readme = md

  try {
    if (options.mirrorImages !== false) {
      readme = await mirrorImages(readme, repo, branch)
    }

    // In-page anchors: <a href="#quick-start"> => absolute
    readme = readme.replace(
      /<a href="#([^"]+)">/gi,
      (_match, anchor: string) => {
        return `<a href="${root}#${anchor}">`
      }
    )

    // Links to files in the repository.
    readme = readme.replace(/href="\/?(.+?)"/gi, (match, path: string) => {
      if (path.startsWith("http")) return match
      return `href="${root}/blob/${branch}/${path}"`
    })

    // Markdown links to repository files, e.g. [docs](./docs/GUIDE.md) or
    // [docs](docs/GUIDE.md). The leading `./` or `/` is optional because
    // READMEs use all three spellings. `(?<!!)` keeps image links out: an
    // image target is a file URL, not a page, so it must not be rewritten
    // as a blob link when there is no OSS mirror to replace it.
    readme = readme.replace(
      /(?<!!)\[([^\]]*)]\(([^)\s]+)\)/gi,
      (match, label: string, target: string) => {
        // Absolute links and other URI schemes (mailto:, tel:) are left as is.
        if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return match
        if (target.startsWith("#")) return match

        const path = target.replace(/^\.?\//, "")
        // "/" and "//host/path" are not repository-relative.
        if (!path || path.startsWith("/")) return match
        return `[${label}](${root}/blob/${branch}/${path})`
      }
    )

    return readme
  } catch (error) {
    console.warn(
      `[readme] processing failed for ${repo}, keeping raw text`,
      error
    )
    return md
  }
}

/**
 * Rewrites Markdown image links and HTML `<img>` tags to point at the
 * mirrored copy when one is available. Failures are per-image: one broken
 * image must not abandon the rest of the README.
 */
async function mirrorImages(
  markdown: string,
  repo: string,
  branch: string
): Promise<string> {
  const mirror = createOssMirror(repo)
  let result = markdown

  const markdownImages = [...markdown.matchAll(/!\[([^\]]*)]\(([^)]+)\)/g)]
  for (const match of markdownImages) {
    const [full, alt, imageUrl] = match
    if (!full || alt === undefined || !imageUrl) continue

    const mirrored = await mirrorSafely(mirror, imageUrl, repo, branch)
    if (mirrored) {
      result = result.replace(full, `![${alt}](${mirrored})`)
    }
  }

  const htmlImages = [
    ...markdown.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi),
  ]
  for (const match of htmlImages) {
    const imageUrl = match[1]
    if (!imageUrl) continue
    const mirrored = await mirrorSafely(mirror, imageUrl, repo, branch)
    if (mirrored) {
      result = result.replace(imageUrl, mirrored)
    }
  }

  return result
}

async function mirrorSafely(
  mirror: ImageMirror,
  imageUrl: string,
  repo: string,
  branch: string
): Promise<string | undefined> {
  try {
    return await mirror(toAbsoluteImageUrl(imageUrl, repo, branch))
  } catch (error) {
    console.warn(`[readme] could not mirror image ${imageUrl}`, error)
    return undefined
  }
}

/**
 * Resolves an image reference to a URL that serves bytes rather than a page.
 *
 * Relative references land on `raw.githubusercontent.com`. GitHub's own
 * viewer URLs are the one absolute form that also has to be rewritten: a
 * `/blob/` link answers with HTML, so mirroring one would upload a rendered
 * page under a `.png` name. Everything else absolute is left alone, which is
 * what keeps {@link MIRROR_HOSTS} honest — it is checked against the URL that
 * is actually fetched, not the one the author wrote.
 *
 * Exported because it decides what a mirror downloads, and the OSS client
 * that would otherwise show it is not configured in the test environment.
 */
export function toAbsoluteImageUrl(
  url: string,
  repo: string,
  branch: string
): string {
  const raw = toRawGitHubUrl(url)
  if (raw) return raw
  if (url.startsWith("http")) return url
  const root = `https://raw.githubusercontent.com/${repo}`
  const path = url.startsWith("./") ? url.slice(2) : url
  return `${root}/${branch}/${path}${svgQuery(url)}`
}

/**
 * Rewrites GitHub's URL for viewing a file into the URL for downloading it.
 *
 * `github.com/owner/repo/blob/main/docs/a.png` renders a page; only
 * `raw.githubusercontent.com/owner/repo/main/docs/a.png` returns the bytes.
 * `/raw/` is GitHub's own redirect to that, handled for the same reason.
 * Returns undefined for anything else so the caller keeps the URL as written.
 */
function toRawGitHubUrl(url: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "")
  if (hostname !== "github.com" && hostname !== "www.github.com") {
    return undefined
  }

  // <owner>/<repo>/(blob|raw)/<ref>/<path...>: five segments with the file
  // last, so a shorter path has no file to serve.
  const segments = parsed.pathname.split("/").filter(Boolean)
  if (segments.length < 5) return undefined

  const [owner, name, kind, ref, ...path] = segments
  if (kind !== "blob" && kind !== "raw") return undefined
  if (!owner || !name || !ref) return undefined

  // The query string is dropped with the page URL: `?raw=true` is only a
  // pointer at the bytes this rewrite fetches directly.
  const rawPath = path.join("/")
  return `https://raw.githubusercontent.com/${owner}/${name}/${ref}/${rawPath}${svgQuery(rawPath)}`
}

/** Raw SVG is only served un-sanitised with this query parameter. */
function svgQuery(path: string): string {
  return /\.svg$/i.test(path) ? "?sanitize=true" : ""
}

/**
 * Determines the file extension from the response headers, falling back to
 * the URL and finally to `.png`. Content type is authoritative because
 * many README image URLs are extension-less.
 */
async function detectExtension(url: string): Promise<string> {
  try {
    // A HEAD against a caller-supplied URL is a request all the same, so it
    // goes out through the same host policy as the download it precedes.
    const response = await safeFetch(url, { method: "HEAD", mode: "strict" })
    if (response.ok) {
      const contentType = response.headers.get("content-type")
      if (contentType) {
        const mapped =
          CONTENT_TYPE_EXTENSIONS[contentType.toLowerCase().split(";")[0] ?? ""]
        if (mapped) return mapped
      }
    }
  } catch {
    // Fall through to the URL-derived extension.
  }
  return extensionFromUrl(url) ?? ".png"
}

function extensionFromUrl(url: string): string | undefined {
  try {
    const fileName = new URL(url).pathname.split("/").pop() ?? ""
    return IMAGE_EXTENSIONS.find((extension) =>
      fileName.toLowerCase().endsWith(extension)
    )
  } catch {
    return undefined
  }
}

function fileNameWithoutExtension(url: string): string {
  let fileName: string
  try {
    fileName = new URL(url).pathname.split("/").pop() ?? "image"
  } catch {
    fileName = url.split("/").pop() ?? "image"
  }

  const extension = IMAGE_EXTENSIONS.find((candidate) =>
    fileName.toLowerCase().endsWith(candidate)
  )
  return extension ? fileName.slice(0, -extension.length) : fileName
}
