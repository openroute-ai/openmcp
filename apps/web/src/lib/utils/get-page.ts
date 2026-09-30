import fs from 'fs'
import matter from 'gray-matter'
import type { Locale } from '@/i18n/routing'
import path from 'path'

interface PageData {
  title: string
  description: string
  date: string
  published?: boolean
  body: string
}

interface ReleaseData extends PageData {
  version: string
  locale: string
}

/**
 * Generic function to read and parse MDX files from a directory
 * @param dirPath The directory path to read from
 * @returns Array of parsed file data
 *
 * `locale` is read off each filename rather than passed in, so it is not a
 * parameter here; callers filter the result themselves.
 */
async function readMdxFiles(
  dirPath: string
): Promise<Array<PageData & { locale: string; filename: string }>> {
  const files: Array<PageData & { locale: string; filename: string }> = []

  try {
    if (!fs.existsSync(dirPath)) {
      console.warn(`Directory not found: ${dirPath}`)
      return files
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.mdx')) {
        const filePath = path.join(dirPath, entry.name)
        const fileContent = fs.readFileSync(filePath, 'utf8')
        const { data, content } = matter(fileContent)

        // Extract locale from filename
        const parts = entry.name.split('.')
        let fileLocale = 'zh' // default locale
        if (parts.length === 3 && parts[2] === 'mdx') {
          fileLocale = parts[1] ?? 'zh'
        }

        files.push({
          title: data.title || '',
          description: data.description || '',
          date: data.date || '',
          published: data.published !== false,
          body: content,
          locale: fileLocale,
          filename: entry.name,
        })
      }
    }
  } catch (error) {
    console.error(`Error reading files from ${dirPath}:`, error)
  }

  return files
}

/**
 * Gets all releases for the changelog page
 * @param locale The locale to get releases for
 * @returns An array of releases sorted by date (newest first)
 */
export async function getReleases(locale: Locale): Promise<ReleaseData[]> {
  const releasesDir = path.join(process.cwd(), 'content', 'release')
  const allFiles = await readMdxFiles(releasesDir)

  // Filter and transform releases
  const releases: ReleaseData[] = allFiles
    .filter((file) => file.published)
    .map((file) => {
      // Extract version from filename
      const version = file.filename.replace(/\.(en|zh)?\.mdx$/, '')

      return {
        ...file,
        version,
      }
    })

  // Filter by locale first
  let filteredReleases = releases.filter((release) => release.locale === locale)

  // If no releases found with the current locale, show all published releases
  if (filteredReleases.length === 0) {
    filteredReleases = releases
  }

  // Sort by date (newest first)
  return filteredReleases.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

/**
 * Gets a specific page from the content/pages directory
 * @param type The type of page (e.g., 'cookie-policy', 'privacy-policy', 'terms-of-service')
 * @param locale The locale to get the page for
 * @returns The page or undefined if not found
 */
export async function getPage(type: string, locale: Locale): Promise<PageData | undefined> {
  try {
    const pagesDir = path.join(process.cwd(), 'content', 'pages')

    // Try to find the localized version first (e.g., cookie-policy.en.mdx)
    const localizedFileName = `${type}.${locale}.mdx`
    const localizedFilePath = path.join(pagesDir, localizedFileName)

    let filePath: string

    if (fs.existsSync(localizedFilePath)) {
      filePath = localizedFilePath
    } else {
      // Fallback to the default version (e.g., cookie-policy.mdx)
      const defaultFileName = `${type}.mdx`
      const defaultFilePath = path.join(pagesDir, defaultFileName)

      if (fs.existsSync(defaultFilePath)) {
        filePath = defaultFilePath
      } else {
        console.warn(`Page not found: ${type} for locale ${locale}`)
        return undefined
      }
    }

    // Read the file content
    const fileContent = fs.readFileSync(filePath, 'utf8')

    // Parse frontmatter and content
    const { data, content } = matter(fileContent)

    // Return the page data
    return {
      title: data.title || '',
      description: data.description || '',
      date: data.date || '',
      published: data.published !== false,
      body: content,
    }
  } catch (error) {
    console.error(`Error reading page ${type} for locale ${locale}:`, error)
    return undefined
  }
}

/**
 * Gets all pages from the content/pages directory
 * @param locale The locale to get pages for
 * @returns Array of pages sorted by date (newest first)
 */
export async function getAllPages(locale: Locale): Promise<PageData[]> {
  const pagesDir = path.join(process.cwd(), 'content', 'pages')
  const allFiles = await readMdxFiles(pagesDir)

  // Filter by locale and published status
  const pages = allFiles
    .filter((file) => file.locale === locale && file.published)
    .map((file) => ({
      title: file.title,
      description: file.description,
      date: file.date,
      published: file.published,
      body: file.body,
    }))

  // If no pages found with the current locale, show all published pages
  if (pages.length === 0) {
    return allFiles
      .filter((file) => file.published)
      .map((file) => ({
        title: file.title,
        description: file.description,
        date: file.date,
        published: file.published,
        body: file.body,
      }))
  }

  // Sort by date (newest first)
  return pages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}
