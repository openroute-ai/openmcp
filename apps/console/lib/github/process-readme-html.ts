/**
 * Rewrites relative URLs in a README returned by GitHub as HTML so they
 * resolve outside github.com. Carried over from the source app; the
 * transformation is purely textual and needs no network access.
 */
export function processReadMeHtml(
  html: string,
  repo: string,
  branch = "main"
): string {
  const root = `https://github.com/${repo}`
  let readme = html

  // In-page anchors: <a href="#quick-start"> => absolute
  readme = readme.replace(/<a href="#([^"]+)">/gi, (_match, anchor: string) => {
    return `<a href="${root}#${anchor}">`
  })

  // Links to files in the repository, e.g. <a href="/docs"> or "docs".
  readme = readme.replace(
    /href="\/?(.+?)"/gi,
    (match, path: string) => {
      if (path.startsWith("http")) return match
      return `href="${root}/blob/${branch}/${path}"`
    }
  )

  // Markdown image links that use a root-relative path: ![cover](/cover.png)
  readme = readme.replace(
    /!\[(.+?)]\(\/(.+?)\)/gi,
    (_match, alt: string, path: string) => `[${alt}](${root}/blob/${branch}/${path})`
  )

  // <img src="..."> with a relative path.
  readme = readme.replace(/src="(.+?)"/gi, (_match, path: string) => {
    return `src="${getImageAbsolutePath(repo, path, branch)}"`
  })

  // GitHub injects anchors into rendered README HTML; they are noise here.
  readme = readme.replace(/<a name=\\?"(.+?)\\?" \/>/gi, "")
  readme = readme.replace(/<a name="(.+?)">/gi, "")
  readme = readme.replace(
    /<a id="user-content(.*)" class="anchor" (.*?)>(.*?)<\/a>/gi,
    ""
  )

  return readme
}

/** Resolves a relative image path to a `raw.githubusercontent.com` URL. */
function getImageAbsolutePath(
  repo: string,
  url: string,
  branch: string
): string {
  if (url.startsWith("http")) return url

  const root = `https://raw.githubusercontent.com/${repo}`
  // Some READMEs write relative paths as "./cover.png".
  const path = url.startsWith("./") ? url.slice(2) : url
  // GitHub serves raw SVG un-sanitised only with this query parameter.
  const queryString = /\.svg$/i.test(url) ? "?sanitize=true" : ""
  return `${root}/${branch}/${path}${queryString}`
}
