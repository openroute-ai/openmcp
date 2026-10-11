/**
 * The one preview image, declared once.
 *
 * Every page's `openGraph` replaces the layout's `openGraph` wholesale — Next
 * resolves `openGraph` per route rather than merging the two objects — so a
 * page that declares a title and no image emits *no* `og:image`, and the link
 * preview falls back to whatever the scraper guesses from the HTML. Duplicating
 * the image object across twenty `metadata` exports is exactly how one page
 * ends up at `1199×629` six months later, so the dimensions live here and each
 * page only says `images: [OG_IMAGE]`.
 *
 * The same object feeds `twitter.images` through Next's inheritance: a page
 * that configures no Twitter tags of its own takes title, description and
 * image from its own `openGraph`, which is where the per-page copy already is.
 */
import { SITE_NAME, siteUrl } from "@/lib/config/site"

export const OG_IMAGE = {
  url: siteUrl("/og.png"),
  width: 1200,
  height: 630,
  alt: SITE_NAME,
} as const
