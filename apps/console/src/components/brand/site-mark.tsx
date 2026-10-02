import { SITE_NAME } from "@/lib/config/site"

/**
 * The site mark.
 *
 * The artwork is `public/logo.svg`, not inline JSX, for three reasons: it is the
 * same file the favicon and the OG image are rendered from, so there is one
 * shape to keep correct; a `<title>` inside it makes the file usable when it is
 * embedded elsewhere (a README badge, a Slack unfurl); and it is a static asset
 * the CDN can cache for a year instead of re-serialising per request.
 *
 * The cost is that it cannot inherit `currentColor` — CSS inside an SVG
 * referenced by `<img>` cannot see the host page. That is why the file bakes in
 * the light-theme primary rather than using a mask; see the comment in the SVG.
 *
 * A plain `<img>` rather than `next/image`: the optimiser refuses to serve SVG
 * without `dangerouslyAllowSVG`, and this is a 32px glyph that gains nothing
 * from responsive `srcset`.
 */
export function SiteMark({ className = "" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.svg"
      alt={`${SITE_NAME} logo`}
      width={32}
      height={32}
      className={className}
    />
  )
}
