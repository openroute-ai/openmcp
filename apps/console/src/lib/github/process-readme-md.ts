import { ossClient } from "@/lib/oss/client"

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
export async function processReadMeMd(
  md: string,
  repo: string,
  branch = "main"
): Promise<string> {
  const root = `https://github.com/${repo}`
  let readme = md

  try {
    readme = await mirrorImages(readme, repo, branch)

    // In-page anchors: <a href="#quick-start"> => absolute
    readme = readme.replace(/<a href="#([^"]+)">/gi, (_match, anchor: string) => {
      return `<a href="${root}#${anchor}">`
    })

    // Links to files in the repository.
    readme = readme.replace(
      /href="\/?(.+?)"/gi,
      (match, path: string) => {
        if (path.startsWith("http")) return match
        return `href="${root}/blob/${branch}/${path}"`
      }
    )

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

/** Resolves a relative image reference to a raw.githubusercontent.com URL. */
function toAbsoluteImageUrl(
  url: string,
  repo: string,
  branch: string
): string {
  if (url.startsWith("http")) return url
  const root = `https://raw.githubusercontent.com/${repo}`
  const path = url.startsWith("./") ? url.slice(2) : url
  // Raw SVG is only served un-sanitised with this query parameter.
  const queryString = /\.svg$/i.test(url) ? "?sanitize=true" : ""
  return `${root}/${branch}/${path}${queryString}`
}

/**
 * Determines the file extension from the response headers, falling back to
 * the URL and finally to `.png`. Content type is authoritative because
 * many README image URLs are extension-less.
 */
async function detectExtension(url: string): Promise<string> {
  try {
    const response = await fetch(url, { method: "HEAD" })
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
