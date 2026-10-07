/**
 * The site logo: a filled tile carrying a node graph — a hub wired to four
 * satellites — which is the same drawing as `public/logo.svg`.
 *
 * Inline JSX rather than `<img src="/logo.svg">`, and the reason is colour. The
 * file bakes its two colours in as hex, because a referenced SVG cannot see the
 * host page: no `dark` class, no custom properties, so dark mode has to be pinned
 * to whichever theme the file was written for. This one is in the document, so
 * `fill-primary` and `currentColor` resolve against the live theme and the logo
 * is the dark-theme primary after sunset without a second file.
 *
 * The consequence is that the geometry now exists twice — here and in
 * `public/logo.svg` — and the copy is the reason the static file still exists at
 * all: the favicon, the manifest icons and the OG image cannot use React. They
 * are rendered from the SVG, so the two drift only if somebody edits one and not
 * the other; change a number here and change it there.
 *
 * Colours are the theme's primary and primary foreground, matching the SVG: the
 * app has no brand palette of its own (see `src/app/[locale]/globals.css` —
 * the landing page deliberately uses the shadcn theme the rest of the console
 * uses), so the theme's primary *is* the brand colour.
 *
 * `aria-hidden`: every call site puts the wordmark next to it, so announcing the
 * mark as well makes a screen reader say the site name twice per page.
 *
 * The `width`/`height` attributes are a floor, not the size — a size class on
 * `className` wins, because CSS beats a presentational attribute, and a caller who
 * forgets one gets 32px instead of the 300×150 an SVG with no intrinsic size
 * defaults to inside a flex row.
 */
export function RadarLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={32}
      height={32}
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`.trim()}
    >
      <rect width="32" height="32" rx="6" className="fill-primary" />
      {/* one `currentColor` for the whole glyph: the nodes fill, the edges stroke */}
      <g className="text-primary-foreground">
        <g fill="currentColor">
          <circle cx="16" cy="16" r="4" opacity="0.9" />
          <circle cx="10" cy="10" r="2.5" opacity="0.8" />
          <circle cx="22" cy="10" r="2.5" opacity="0.8" />
          <circle cx="10" cy="22" r="2.5" opacity="0.8" />
          <circle cx="22" cy="22" r="2.5" opacity="0.8" />
        </g>
        <g
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          opacity="0.6"
        >
          <line x1="16" y1="16" x2="10" y2="10" />
          <line x1="16" y1="16" x2="22" y2="10" />
          <line x1="16" y1="16" x2="10" y2="22" />
          <line x1="16" y1="16" x2="22" y2="22" />
        </g>
      </g>
    </svg>
  )
}
